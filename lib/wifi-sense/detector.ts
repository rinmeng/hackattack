// Motion detection from the short-term spread of RSSI. Pure TypeScript: no DOM, no
// React. Feed it samples with `push`, call `tick` on a timer, read `snapshot()`.
//
// RSSI can go up, down or stay put when someone crosses the link, so we never look at
// its level, only at how much it wobbles over a short window (the "score").

import type {
  WifiCalibration,
  WifiCalibrationStep,
  WifiDetectorSettings,
  WifiDetectorSnapshot,
  WifiDetectorState,
  WifiEvent,
  WifiEventType,
  WifiRecalibrationReason,
  WifiSample,
} from '@/lib/types';
import {
  CH_MOTION,
  CH_RSSI,
  CH_SCORE,
  CH_T,
  CH_THRESHOLD,
  CH_TX_RATE,
  DISPLAY_DECIMALS,
  EXIT_RATIO,
  LINK_CHANGE_HOLD_MS,
  LINK_RSSI_JUMP_DB,
  LINK_TX_RATE_JUMP_RATIO,
  LINK_WINDOW_MS,
  MIN_CALIBRATION_SAMPLES,
  MIN_THRESHOLD_DB,
  MIN_WINDOW_FILL,
  MIN_WINDOW_SAMPLES,
  MS_PER_SECOND,
  OUTSIDE_PERCENTILE,
  RING_CAPACITY,
  RING_CHANNELS,
  RSSI_MAX_DBM,
  RSSI_MIN_DBM,
  STALE_MS,
  STEP_RESET_DB,
} from './constants';
import { RingBuffer } from './ring-buffer';

const BIN_COUNT = RSSI_MAX_DBM - RSSI_MIN_DBM + 1;

function toBin(rssi: number): number {
  const r = Math.round(rssi);
  if (r < RSSI_MIN_DBM) return 0;
  if (r > RSSI_MAX_DBM) return BIN_COUNT - 1;
  return r - RSSI_MIN_DBM;
}

/**
 * Rolling time window over the ring buffer. Keeps running sums and a histogram of
 * whole-dBm RSSI values, so mean, std dev, mean absolute deviation and median cost
 * O(1) or O(histogram bins) per sample, never a rescan of the window.
 */
class RssiWindow {
  lengthMs: number;
  private readonly ring: RingBuffer;
  private readonly bins = new Int32Array(BIN_COUNT);
  private tail = 0;
  private n = 0;
  private sum = 0;
  private sumSq = 0;
  private txSum = 0;

  constructor(ring: RingBuffer, lengthMs: number) {
    this.ring = ring;
    this.lengthMs = lengthMs;
  }

  get count(): number {
    return this.n;
  }

  /** Timestamp of the oldest sample in the window, or NaN when empty. */
  get oldestT(): number {
    return this.n > 0 ? this.ring.get(CH_T, this.tail) : NaN;
  }

  reset(): void {
    this.bins.fill(0);
    this.tail = this.ring.endSeq;
    this.n = 0;
    this.sum = 0;
    this.sumSq = 0;
    this.txSum = 0;
  }

  /** Adds the sample at `seq` (the newest one) and drops samples older than the window. */
  add(seq: number): void {
    if (this.n === 0) this.tail = seq;
    const rssi = this.ring.get(CH_RSSI, seq);
    this.bins[toBin(rssi)]++;
    this.n++;
    this.sum += rssi;
    this.sumSq += rssi * rssi;
    this.txSum += this.ring.get(CH_TX_RATE, seq);
    this.evict(this.ring.get(CH_T, seq));
  }

  /** Re-reads the window from the ring buffer. Only for settings changes. */
  rebuild(): void {
    const end = this.ring.endSeq;
    this.reset();
    if (end === 0) return;
    const newestT = this.ring.get(CH_T, end - 1);
    let start = end;
    while (
      start > this.ring.firstSeq &&
      newestT - this.ring.get(CH_T, start - 1) <= this.lengthMs
    ) {
      start--;
    }
    for (let seq = start; seq < end; seq++) this.add(seq);
  }

  private evict(nowT: number): void {
    // If the ring has overwritten our tail (only with absurd window lengths), rebuild.
    if (this.tail < this.ring.firstSeq) {
      this.rebuild();
      return;
    }
    while (this.n > 1 && nowT - this.ring.get(CH_T, this.tail) > this.lengthMs) {
      const rssi = this.ring.get(CH_RSSI, this.tail);
      this.bins[toBin(rssi)]--;
      this.n--;
      this.sum -= rssi;
      this.sumSq -= rssi * rssi;
      this.txSum -= this.ring.get(CH_TX_RATE, this.tail);
      this.tail++;
    }
  }

  /** True once the window holds enough samples spanning most of its length. */
  isFilled(nowT: number): boolean {
    return (
      this.n >= MIN_WINDOW_SAMPLES &&
      nowT - this.oldestT >= this.lengthMs * MIN_WINDOW_FILL
    );
  }

  mean(): number {
    return this.sum / this.n;
  }

  std(): number {
    const m = this.mean();
    return Math.sqrt(Math.max(0, this.sumSq / this.n - m * m));
  }

  /** Mean absolute deviation around the mean, exact thanks to the histogram. */
  mad(): number {
    const m = this.mean();
    let acc = 0;
    for (let b = 0; b < BIN_COUNT; b++) {
      const c = this.bins[b];
      if (c !== 0) acc += c * Math.abs(b + RSSI_MIN_DBM - m);
    }
    return acc / this.n;
  }

  median(): number {
    const half = this.n / 2;
    let cum = 0;
    for (let b = 0; b < BIN_COUNT; b++) {
      cum += this.bins[b];
      if (cum >= half) return b + RSSI_MIN_DBM;
    }
    return NaN;
  }

  txMean(): number {
    return this.txSum / this.n;
  }
}

interface CalibrationRun {
  step: WifiCalibrationStep;
  startedAt: number;
  durationMs: number;
  count: number;
  // Welford running mean and sum of squared deviations
  mean: number;
  m2: number;
}

export interface MotionDetectorOptions {
  settings: WifiDetectorSettings;
  calibration: WifiCalibration | null;
  onEvent: (event: WifiEvent) => void;
}

export class MotionDetector {
  /** Every link sample with its score, threshold and motion flag, for the chart. */
  readonly ring = new RingBuffer(RING_CAPACITY, RING_CHANNELS);

  private settings: WifiDetectorSettings;
  private calibration: WifiCalibration | null;
  private readonly onEvent: (event: WifiEvent) => void;
  private readonly scoreWindow: RssiWindow;
  private readonly linkWindow: RssiWindow;
  private readonly calScores = new Float64Array(RING_CAPACITY);

  private connected: boolean | null = null;
  private stale = false;
  private motion = false;
  private aboveSince = NaN;
  private belowSince = NaN;
  private linkJumpSince = NaN;
  private recalibrationReason: WifiRecalibrationReason | null = null;
  private run: CalibrationRun | null = null;
  private calibrationError: string | null = null;

  private score = NaN;
  private lastRssi = NaN;
  private lastNoise = NaN;
  private lastTxRate = NaN;
  private lastSampleAt = NaN;
  private lastDistinctAt = NaN;
  private eventId = 0;

  constructor({ settings, calibration, onEvent }: MotionDetectorOptions) {
    this.settings = settings;
    this.calibration = calibration;
    this.onEvent = onEvent;
    this.scoreWindow = new RssiWindow(this.ring, settings.windowMs);
    this.linkWindow = new RssiWindow(this.ring, LINK_WINDOW_MS);
    this.checkCalibrationMatchesSettings();
  }

  // -------------------------------------------------------------------------------
  // Inputs
  // -------------------------------------------------------------------------------

  push(sample: WifiSample): void {
    const t = sample.t;
    this.lastSampleAt = t;

    if ('error' in sample) {
      this.handleDisconnected(t);
      return;
    }

    if (this.connected === false) {
      this.emit('reconnected', t);
      this.resetWindows();
    }
    this.connected = true;

    // One jump this big is the link changing level (roaming, band switch), not a body
    // in the path. Start the score window afresh so the step itself doesn't read as
    // spread; the link-change guard then decides whether to ask for recalibration.
    if (Math.abs(sample.rssi - this.lastRssi) > STEP_RESET_DB) this.scoreWindow.reset();

    // A fresh reading changes RSSI or noise; a frozen driver repeats both.
    if (sample.rssi !== this.lastRssi || sample.noise !== this.lastNoise) {
      this.lastDistinctAt = t;
      if (this.stale) {
        this.stale = false;
        this.resetTimers();
      }
    }
    this.lastRssi = sample.rssi;
    this.lastNoise = sample.noise;
    this.lastTxRate = sample.txRate;

    const seq = this.ring.push();
    this.ring.set(CH_T, seq, t);
    this.ring.set(CH_RSSI, seq, sample.rssi);
    this.ring.set(CH_TX_RATE, seq, sample.txRate);
    this.scoreWindow.add(seq);
    this.linkWindow.add(seq);

    this.score = this.computeScore(t);
    const threshold = this.threshold();

    if (this.run && Number.isFinite(this.score)) this.accumulateCalibration(this.score);
    this.checkCalibrationDone(t);
    this.evaluate(t, threshold);

    this.ring.set(CH_SCORE, seq, this.score);
    this.ring.set(CH_THRESHOLD, seq, threshold);
    this.ring.set(CH_MOTION, seq, this.motion ? 1 : 0);
  }

  /** Call regularly (even with no samples) so staleness and countdowns move on. */
  tick(now: number): void {
    this.checkCalibrationDone(now);
    if (
      this.connected &&
      !this.stale &&
      Number.isFinite(this.lastDistinctAt) &&
      now - this.lastDistinctAt > STALE_MS
    ) {
      this.stale = true;
      this.forceClear(now, 'no fresh readings');
      this.emit(
        'stale',
        now,
        `no new RSSI value for ${Math.round(STALE_MS / MS_PER_SECOND)} s`
      );
    }
  }

  setSettings(settings: WifiDetectorSettings): void {
    const windowChanged = settings.windowMs !== this.settings.windowMs;
    this.settings = settings;
    if (windowChanged) {
      this.scoreWindow.lengthMs = settings.windowMs;
      this.scoreWindow.rebuild();
    }
    this.checkCalibrationMatchesSettings();
  }

  setCalibration(calibration: WifiCalibration | null): void {
    this.calibration = calibration;
    this.recalibrationReason = null;
    this.linkJumpSince = NaN;
    this.resetTimers();
    this.checkCalibrationMatchesSettings();
  }

  getCalibration(): WifiCalibration | null {
    return this.calibration;
  }

  /** Returns false (and records why) if the step can't start. */
  startCalibration(step: WifiCalibrationStep, durationMs: number, now: number): boolean {
    if (step === 'outside' && !this.calibration) {
      this.calibrationError = 'Run "Empty room" first.';
      return false;
    }
    this.calibrationError = null;
    this.run = { step, startedAt: now, durationMs, count: 0, mean: 0, m2: 0 };
    this.forceClear(now, 'calibrating');
    return true;
  }

  cancelCalibration(): void {
    this.run = null;
  }

  // -------------------------------------------------------------------------------
  // Output
  // -------------------------------------------------------------------------------

  snapshot(now: number): WifiDetectorSnapshot {
    const threshold = this.threshold();
    return {
      state: this.displayState(),
      score: finiteOrNull(this.score),
      threshold: finiteOrNull(threshold),
      rssi: finiteOrNull(this.lastRssi),
      noise: finiteOrNull(this.lastNoise),
      txRate: finiteOrNull(this.lastTxRate),
      lastSampleAt: finiteOrNull(this.lastSampleAt),
      lastDistinctAt: finiteOrNull(this.lastDistinctAt),
      calibration: this.calibration,
      calibrating: this.run
        ? {
            step: this.run.step,
            startedAt: this.run.startedAt,
            durationMs: this.run.durationMs,
            elapsedMs: Math.min(this.run.durationMs, now - this.run.startedAt),
          }
        : null,
      recalibrationReason: this.recalibrationReason,
      calibrationError: this.calibrationError,
    };
  }

  /** Current effective threshold T, or NaN before calibration. */
  threshold(): number {
    const c = this.calibration;
    if (!c) return NaN;
    const fromRoom = c.mu + this.settings.k * c.sigma;
    const fromOutside =
      c.p95Outside === null ? 0 : this.settings.outsideFactor * c.p95Outside;
    return Math.max(
      MIN_THRESHOLD_DB,
      Math.max(fromRoom, fromOutside) * this.settings.thresholdScale
    );
  }

  // -------------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------------

  private displayState(): WifiDetectorState {
    if (this.connected === false) return 'DISCONNECTED';
    if (this.connected === null || this.stale) return 'STALE';
    if (this.run) return 'CALIBRATING';
    if (this.recalibrationReason) return 'NEEDS_RECALIBRATION';
    if (!this.calibration) return 'UNCALIBRATED';
    return this.motion ? 'MOTION' : 'CLEAR';
  }

  private computeScore(t: number): number {
    if (!this.scoreWindow.isFilled(t)) return NaN;
    return this.settings.scoreType === 'mad'
      ? this.scoreWindow.mad()
      : this.scoreWindow.std();
  }

  private evaluate(t: number, threshold: number): void {
    if (this.stale || this.run || !this.calibration || this.recalibrationReason) {
      this.resetTimers();
      return;
    }
    if (!Number.isFinite(this.score)) return;

    if (this.checkLinkChange(t, threshold)) return;

    if (!this.motion) {
      if (this.score > threshold) {
        if (Number.isNaN(this.aboveSince)) this.aboveSince = t;
        if (t - this.aboveSince >= this.settings.enterHoldMs) {
          this.motion = true;
          this.belowSince = NaN;
          this.emit('motion_start', t);
        }
      } else {
        this.aboveSince = NaN;
      }
    } else if (this.score < threshold * EXIT_RATIO) {
      if (Number.isNaN(this.belowSince)) this.belowSince = t;
      if (t - this.belowSince >= this.settings.exitHoldMs) {
        this.motion = false;
        this.aboveSince = NaN;
        this.emit('motion_end', t);
      }
    } else {
      this.belowSince = NaN;
    }
  }

  /**
   * The link itself changed (laptop or router moved, other AP, band switch) if the
   * 10 s median RSSI or the mean transmit rate moved far from the calibration
   * baseline and stayed there while the signal was calm. Someone walking makes the
   * signal wobble, so a calm-but-shifted signal isn't motion.
   */
  private checkLinkChange(t: number, threshold: number): boolean {
    const c = this.calibration;
    if (!c || !this.linkWindow.isFilled(t)) return false;
    const median = this.linkWindow.median();
    const txMean = this.linkWindow.txMean();
    const rssiJump = Math.abs(median - c.baselineRssi) > LINK_RSSI_JUMP_DB;
    const txJump =
      c.baselineTxRate > 0 &&
      Math.abs(txMean / c.baselineTxRate - 1) > LINK_TX_RATE_JUMP_RATIO;
    const calm = this.score < threshold * EXIT_RATIO;

    if (!(rssiJump || txJump) || !calm) {
      this.linkJumpSince = NaN;
      return false;
    }
    if (Number.isNaN(this.linkJumpSince)) this.linkJumpSince = t;
    if (t - this.linkJumpSince < LINK_CHANGE_HOLD_MS) return false;

    this.recalibrationReason = 'link_changed';
    this.linkJumpSince = NaN;
    this.forceClear(t, 'link changed');
    this.emit(
      'link_changed',
      t,
      rssiJump
        ? `median RSSI ${c.baselineRssi} -> ${median} dBm`
        : `tx rate ${Math.round(c.baselineTxRate)} -> ${Math.round(txMean)} Mbps`
    );
    return true;
  }

  private handleDisconnected(t: number): void {
    if (this.connected === false) return;
    this.connected = false;
    this.run = null;
    this.forceClear(t, 'link lost');
    this.resetWindows();
    this.score = NaN;
    this.emit('disconnected', t);
  }

  private accumulateCalibration(score: number): void {
    const run = this.run;
    if (!run || run.count >= this.calScores.length) return;
    this.calScores[run.count] = score;
    run.count++;
    const delta = score - run.mean;
    run.mean += delta / run.count;
    run.m2 += delta * (score - run.mean);
  }

  private checkCalibrationDone(now: number): void {
    const run = this.run;
    if (!run || now - run.startedAt < run.durationMs) return;
    this.run = null;

    if (run.count < MIN_CALIBRATION_SAMPLES) {
      this.calibrationError = 'Too few readings. Check the collector and try again.';
      return;
    }

    if (run.step === 'empty') {
      const sigma = Math.sqrt(run.m2 / (run.count - 1));
      this.calibration = {
        mu: run.mean,
        sigma,
        p95Outside: null,
        scoreType: this.settings.scoreType,
        windowMs: this.settings.windowMs,
        baselineRssi: this.linkWindow.count ? this.linkWindow.median() : this.lastRssi,
        baselineTxRate: this.linkWindow.count
          ? this.linkWindow.txMean()
          : this.lastTxRate,
        calibratedAt: now,
      };
      this.recalibrationReason = null;
      this.emit(
        'calibrated',
        now,
        `empty room: mu ${fmt(run.mean)}, sigma ${fmt(sigma)}`
      );
    } else if (this.calibration) {
      const scores = this.calScores.subarray(0, run.count).sort();
      const p95 = scores[Math.floor(OUTSIDE_PERCENTILE * (run.count - 1))];
      this.calibration = { ...this.calibration, p95Outside: p95 };
      this.emit('calibrated', now, `outside motion: p95 ${fmt(p95)}`);
    }
    this.resetTimers();
  }

  private checkCalibrationMatchesSettings(): void {
    const c = this.calibration;
    const mismatch =
      c !== null &&
      (c.scoreType !== this.settings.scoreType || c.windowMs !== this.settings.windowMs);
    if (mismatch) {
      this.recalibrationReason = 'settings_changed';
      this.forceClear(this.lastSampleAt, 'settings changed');
    } else if (this.recalibrationReason === 'settings_changed') {
      this.recalibrationReason = null;
    }
  }

  /** Leaves MOTION (logging it) when something makes detection unreliable. */
  private forceClear(t: number, reason: string): void {
    if (this.motion) {
      this.motion = false;
      this.emit('motion_end', t, reason);
    }
    this.resetTimers();
  }

  private resetTimers(): void {
    this.aboveSince = NaN;
    this.belowSince = NaN;
  }

  private resetWindows(): void {
    this.scoreWindow.reset();
    this.linkWindow.reset();
    this.linkJumpSince = NaN;
  }

  private emit(type: WifiEventType, t: number, detail?: string): void {
    this.eventId++;
    this.onEvent({
      id: this.eventId,
      type,
      t,
      score: finiteOrNull(this.score),
      threshold: finiteOrNull(this.threshold()),
      detail,
    });
  }
}

function finiteOrNull(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}

function fmt(n: number): string {
  return n.toFixed(DISPLAY_DECIMALS);
}
