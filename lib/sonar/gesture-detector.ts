/**
 * Per-tone Doppler tracking, gating and the gesture state machine.
 *
 * Feed it one spectrum per animation frame with `process()`. It reuses one frame
 * object and preallocated state, so the per-frame path doesn't allocate. Listeners
 * subscribe with `on(event, fn)` / `off(event, fn)`:
 *
 * - 'left' / 'right': a gesture fired (from sonar, keyboard or a click)
 * - 'motion': per-frame data (the shared frame object; read it synchronously)
 * - 'status': the status changed
 * - 'log': an event log entry
 * - 'calibrated': calibration finished
 */
import type {
  CalibrationResult,
  GestureDirection,
  GestureSource,
  SonarBaseline,
  SonarEventMap,
  SonarEventName,
  SonarFrame,
  SonarListener,
  SonarLogKind,
  SonarSettings,
  SonarStatus,
  ToneFrame,
  ToneId,
  ToneScan,
  ToneScanParams,
} from '@/lib/types';

import {
  CONTINUOUS_RELEASE_MS,
  DEFAULT_SETTINGS,
  DRIFT_ALPHA,
  DRIFT_IDLE_MS,
  GUARD_NOISE_Z,
  MAX_SCAN_HZ,
  MOTION_GAP_TOLERANCE_MS,
  NOISE_LOG_GAP_MS,
  NOISE_STATUS_HOLD_MS,
  PEAK_SEARCH_RADIUS_BINS,
  PUSH_PULL_FRAMES,
  TONE_IDS,
  TYPING_PAUSE_MS,
} from './constants';
import {
  bandEnergy,
  ema,
  emaStd,
  freqToBin,
  guardEndHz,
  guardStartHz,
  linearToDb,
  maxScanBins,
  scanTone,
  shiftToVelocity,
  zScore,
} from './dsp';

type ListenerStore = { [E in SonarEventName]: SonarListener<E>[] };

/** Minimal typed event emitter. Arrays (not Sets) so emitting doesn't allocate. */
export class SonarEmitter {
  private listeners: ListenerStore = {
    left: [],
    right: [],
    motion: [],
    status: [],
    log: [],
    calibrated: [],
  };

  on<E extends SonarEventName>(event: E, fn: SonarListener<E>): () => void {
    const list: SonarListener<E>[] = this.listeners[event];
    list.push(fn);
    return () => this.off(event, fn);
  }

  off<E extends SonarEventName>(event: E, fn: SonarListener<E>): void {
    const list: SonarListener<E>[] = this.listeners[event];
    const index = list.indexOf(fn);
    if (index >= 0) list.splice(index, 1);
  }

  emit<E extends SonarEventName>(event: E, payload: SonarEventMap[E]): void {
    const list: SonarListener<E>[] = this.listeners[event];
    for (let i = 0; i < list.length; i++) list[i](payload);
  }
}

/** Tracking state for one tone's motion. */
interface ToneTrack {
  /** Consecutive moving frames (strict, for the debounce). */
  run: number;
  /** Time of the first frame of the current run. */
  runStart: number;
  /** Start of the current motion episode (tolerates short gaps), or -1. */
  episodeStart: number;
  /** Last frame this tone was moving. */
  lastMoving: number;
  /** Onset of a debounced burst waiting for its partner (Mode A), or -1. */
  pendingOnset: number;
}

function createToneFrame(): ToneFrame {
  return {
    toneHz: 0,
    toneBin: 0,
    peakBin: 0,
    peakAmp: 0,
    peakDb: -Infinity,
    leftBins: 0,
    rightBins: 0,
    dL: 0,
    dR: 0,
    shiftBins: 0,
    velocity: 0,
    energy: 0,
    zE: 0,
    moving: false,
  };
}

function createTrack(): ToneTrack {
  return {
    run: 0,
    runStart: 0,
    episodeStart: -1,
    lastMoving: -Infinity,
    pendingOnset: -1,
  };
}

export class GestureDetector extends SonarEmitter {
  private settings: SonarSettings = DEFAULT_SETTINGS;
  private baseline: SonarBaseline | null = null;
  private sampleRate = 0;
  private status: SonarStatus = 'idle';
  /** Externally set phase: idle, starting, calibrating, keep-still, paused, or
   * listening (in which case the status is derived per frame). */
  private phase: SonarStatus = 'idle';

  readonly frame: SonarFrame = {
    time: 0,
    sampleRate: 0,
    binWidth: 0,
    spectrumDb: null,
    baselineSpectrum: null,
    thresholdFrac: DEFAULT_SETTINGS.bandwidthThresholdPct / 100,
    tones: { L: createToneFrame(), R: createToneFrame() },
    guardZ: 0,
    noise: false,
    detecting: false,
  };

  private tracks: Record<ToneId, ToneTrack> = { L: createTrack(), R: createTrack() };
  private scan: ToneScan = {
    peakBin: 0,
    peakAmp: 0,
    leftBins: 0,
    rightBins: 0,
    energy: 0,
  };
  private scanParams: ToneScanParams = {
    peakSearchRadius: PEAK_SEARCH_RADIUS_BINS,
    maxBins: 0,
    thresholdFrac: DEFAULT_SETTINGS.bandwidthThresholdPct / 100,
    secondPeakFrac: DEFAULT_SETTINGS.secondPeakPct / 100,
  };

  private lastTrigger = -Infinity;
  private lastDirection: GestureDirection | null = null;
  private lastAnyMoving = -Infinity;
  private lastNoise = -Infinity;
  private ignoreUntil = -Infinity;
  private blocked = false;
  private pushRun = 0;
  private pullRun = 0;
  private logId = 0;

  updateSettings(settings: SonarSettings): void {
    this.settings = settings;
    this.scanParams.thresholdFrac = settings.bandwidthThresholdPct / 100;
    this.scanParams.secondPeakFrac = settings.secondPeakPct / 100;
    this.frame.thresholdFrac = this.scanParams.thresholdFrac;
  }

  setSampleRate(sampleRate: number): void {
    this.sampleRate = sampleRate;
    this.frame.sampleRate = sampleRate;
  }

  get hasBaseline(): boolean {
    return this.baseline !== null;
  }

  /** Install a fresh calibration and start listening. */
  applyCalibration(result: CalibrationResult, now: number): void {
    this.baseline = result.baseline;
    this.frame.baselineSpectrum = result.baseline.spectrum;
    this.resetTracking(now);
    this.emit('calibrated', result);
  }

  clearBaseline(): void {
    this.baseline = null;
    this.frame.baselineSpectrum = null;
  }

  /** Set the externally driven phase. 'listening' hands status back to the frames. */
  setPhase(phase: SonarStatus): void {
    this.phase = phase;
    this.setStatus(phase);
  }

  getStatus(): SonarStatus {
    return this.status;
  }

  /** Ignore frames until `until` (typing pause, tab resume). */
  ignoreFramesUntil(until: number, now: number): void {
    if (until > this.ignoreUntil) this.ignoreUntil = until;
    this.clearPending(now);
  }

  /** A non-arrow key was pressed: pause detection briefly. */
  noteKeydown(now: number): void {
    this.ignoreFramesUntil(now + TYPING_PAUSE_MS, now);
  }

  /** Fire a gesture directly (arrow keys, button clicks). Skips sonar gating. */
  manualTrigger(direction: GestureDirection, source: GestureSource, now: number): void {
    this.emit(direction, { direction, source, time: now, detail: source });
  }

  log(kind: SonarLogKind, message: string): void {
    this.logId++;
    this.emit('log', { id: this.logId, at: Date.now(), kind, message });
  }

  resetTracking(now: number): void {
    for (const id of TONE_IDS) {
      const track = this.tracks[id];
      track.run = 0;
      track.runStart = now;
      track.episodeStart = -1;
      track.lastMoving = -Infinity;
      track.pendingOnset = -1;
    }
    this.blocked = false;
    this.pushRun = 0;
    this.pullRun = 0;
    this.lastAnyMoving = now;
    this.lastNoise = -Infinity;
  }

  /**
   * Process one spectrum. `toneHz` gives the frequencies actually playing (they
   * differ from the settings during a sweep). With `detect` false the frame is
   * computed for display only.
   */
  process(
    mag: Float32Array,
    db: Float32Array,
    now: number,
    toneLHz: number,
    toneRHz: number,
    detect: boolean
  ): void {
    const frame = this.frame;
    const bins = mag.length;
    if (bins === 0 || this.sampleRate <= 0) return;

    const binWidth = this.sampleRate / (bins * 2);
    frame.time = now;
    frame.binWidth = binWidth;
    frame.spectrumDb = db;
    frame.noise = false;
    this.scanParams.maxBins = maxScanBins(MAX_SCAN_HZ, binWidth);

    const baseline =
      this.baseline && this.baseline.spectrum.length === bins ? this.baseline : null;
    frame.baselineSpectrum = baseline ? baseline.spectrum : null;

    // --- Per-tone measurement -------------------------------------------------
    for (let t = 0; t < TONE_IDS.length; t++) {
      const id = TONE_IDS[t];
      const tone = frame.tones[id];
      tone.toneHz = id === 'L' ? toneLHz : toneRHz;
      tone.toneBin = freqToBin(tone.toneHz, binWidth);
      scanTone(mag, tone.toneBin, this.scanParams, this.scan);
      tone.peakBin = this.scan.peakBin;
      tone.peakAmp = this.scan.peakAmp;
      tone.peakDb = linearToDb(this.scan.peakAmp);
      tone.leftBins = this.scan.leftBins;
      tone.rightBins = this.scan.rightBins;
      tone.energy = this.scan.energy;

      if (baseline) {
        const b = baseline.tones[id];
        tone.dL = tone.leftBins - b.leftMean;
        tone.dR = tone.rightBins - b.rightMean;
        tone.shiftBins = tone.dR - tone.dL;
        tone.velocity = shiftToVelocity(tone.shiftBins, binWidth, tone.toneHz);
        tone.zE = zScore(tone.energy, b.energyMean, b.energyStd);
        tone.moving =
          Math.max(tone.dL, tone.dR) >= this.settings.minShiftBins &&
          tone.zE >= this.settings.minProximityZ;
      } else {
        tone.dL = 0;
        tone.dR = 0;
        tone.shiftBins = 0;
        tone.velocity = 0;
        tone.zE = 0;
        tone.moving = false;
      }
    }

    let guardEnergy = 0;
    if (baseline) {
      guardEnergy = bandEnergy(
        mag,
        freqToBin(guardStartHz(toneLHz), binWidth),
        freqToBin(guardEndHz(toneLHz), binWidth)
      );
      frame.guardZ = zScore(guardEnergy, baseline.guardMean, baseline.guardStd);
    } else {
      frame.guardZ = 0;
    }

    frame.detecting = detect && baseline !== null && this.phase === 'listening';
    if (frame.detecting && baseline) {
      this.detect(now, baseline, mag, guardEnergy);
    }

    this.emit('motion', frame);
  }

  // --- Gating and gesture state machine ----------------------------------------

  private detect(
    now: number,
    baseline: SonarBaseline,
    mag: Float32Array,
    guardEnergy: number
  ): void {
    const frame = this.frame;
    const settings = this.settings;

    // Guard band: broadband noise (clap, keys). Ignore the frame entirely.
    if (frame.guardZ > GUARD_NOISE_Z) {
      frame.noise = true;
      if (now - this.lastNoise > NOISE_LOG_GAP_MS) {
        this.log(
          'noise',
          `Broadband noise (guard z ${frame.guardZ.toFixed(1)}), ignored`
        );
      }
      this.lastNoise = now;
      this.updateStatus(now);
      return;
    }

    // Typing pause and tab-resume settle.
    if (now < this.ignoreUntil) {
      this.updateStatus(now);
      return;
    }

    const L = frame.tones.L;
    const R = frame.tones.R;
    let anyMoving = false;

    for (let t = 0; t < TONE_IDS.length; t++) {
      const id = TONE_IDS[t];
      const tone = frame.tones[id];
      const track = this.tracks[id];

      if (tone.moving) {
        anyMoving = true;
        if (track.run === 0) track.runStart = now;
        track.run++;
        if (track.episodeStart < 0 || now - track.lastMoving > MOTION_GAP_TOLERANCE_MS) {
          track.episodeStart = now;
        }
        track.lastMoving = now;
        if (track.run === settings.debounceFrames) {
          this.onBurst(id, track.runStart, now);
        }
      } else {
        track.run = 0;
        if (now - track.lastMoving > MOTION_GAP_TOLERANCE_MS) track.episodeStart = -1;
      }

      // Continuous-motion block.
      if (
        !this.blocked &&
        track.episodeStart >= 0 &&
        now - track.episodeStart > settings.continuousMotionLimitMs
      ) {
        this.blocked = true;
        this.clearPending(now);
        this.log(
          'suppressed',
          `Too much motion on tone ${id} (> ${settings.continuousMotionLimitMs} ms), blocking triggers`
        );
      }
    }

    if (anyMoving) this.lastAnyMoving = now;

    if (this.blocked && now - this.lastAnyMoving >= CONTINUOUS_RELEASE_MS) {
      this.blocked = false;
      for (const id of TONE_IDS) this.tracks[id].episodeStart = -1;
      this.log('info', 'Motion settled, triggers re-enabled');
    }

    // Mode A: expire bursts that never found a partner.
    if (settings.mode === 'stereo') {
      for (const id of TONE_IDS) {
        const track = this.tracks[id];
        if (track.pendingOnset >= 0 && now - track.pendingOnset > settings.pairWindowMs) {
          track.pendingOnset = -1;
          this.log('burst', `Burst on tone ${id} only, no partner within window`);
        }
      }
    }

    // Mode B: sustained push (toward) or pull (away), averaged over both tones.
    if (settings.mode === 'pushpull') {
      const shift = (L.shiftBins + R.shiftBins) / 2;
      const near = Math.max(L.zE, R.zE) >= settings.minProximityZ;
      this.pushRun = near && shift >= settings.minShiftBins ? this.pushRun + 1 : 0;
      this.pullRun = near && shift <= -settings.minShiftBins ? this.pullRun + 1 : 0;
      if (this.pushRun === PUSH_PULL_FRAMES) {
        this.fire('right', now, `push (avg shift ${shift.toFixed(1)} bins)`);
      } else if (this.pullRun === PUSH_PULL_FRAMES) {
        this.fire('left', now, `pull (avg shift ${shift.toFixed(1)} bins)`);
      }
    }

    // Drift: after a long quiet spell, slowly track the baseline.
    if (now - this.lastAnyMoving >= DRIFT_IDLE_MS) {
      this.drift(baseline, mag, guardEnergy);
    }

    this.updateStatus(now);
  }

  /** Mode A: a debounced burst started on one tone. */
  private onBurst(id: ToneId, onset: number, now: number): void {
    const settings = this.settings;
    if (settings.mode !== 'stereo') return;
    const other: ToneId = id === 'L' ? 'R' : 'L';
    const partner = this.tracks[other].pendingOnset;

    if (partner >= 0 && Math.abs(onset - partner) <= settings.pairWindowMs) {
      const onsetL = id === 'L' ? onset : partner;
      const onsetR = id === 'R' ? onset : partner;
      this.tracks.L.pendingOnset = -1;
      this.tracks.R.pendingOnset = -1;
      const gap = onsetR - onsetL; // positive: L moved first
      if (Math.abs(gap) < settings.onsetGapMs) {
        this.log(
          'ambiguous',
          `Ambiguous wave: onsets ${Math.abs(gap).toFixed(0)} ms apart (< ${settings.onsetGapMs} ms)`
        );
        return;
      }
      // L before R: the hand passed the left speaker first, so it moved right.
      const direction: GestureDirection = gap > 0 ? 'right' : 'left';
      this.fire(
        direction,
        now,
        `${gap > 0 ? 'L' : 'R'} first by ${Math.abs(gap).toFixed(0)} ms`
      );
      return;
    }

    this.tracks[id].pendingOnset = onset;
  }

  private fire(raw: GestureDirection, now: number, detail: string): void {
    const settings = this.settings;
    const direction: GestureDirection = settings.invertDirection
      ? raw === 'left'
        ? 'right'
        : 'left'
      : raw;

    if (this.blocked) {
      this.log('suppressed', `${direction.toUpperCase()} suppressed: too much motion`);
      return;
    }
    if (now - this.lastTrigger < settings.cooldownMs) {
      this.log('suppressed', `${direction.toUpperCase()} suppressed: cooldown`);
      return;
    }
    // The hand resetting after a gesture moves the opposite way: ignore it.
    if (
      this.lastDirection !== null &&
      direction !== this.lastDirection &&
      now - this.lastTrigger < settings.returnLockoutMs
    ) {
      this.log(
        'suppressed',
        `${direction.toUpperCase()} suppressed: return stroke after ${this.lastDirection.toUpperCase()}`
      );
      return;
    }
    this.lastTrigger = now;
    this.lastDirection = direction;
    this.log('trigger', `${direction.toUpperCase()} (${detail})`);
    this.emit(direction, { direction, source: 'sonar', time: now, detail });
  }

  private clearPending(now: number): void {
    for (const id of TONE_IDS) {
      const track = this.tracks[id];
      track.pendingOnset = -1;
      track.run = 0;
      track.runStart = now;
    }
    this.pushRun = 0;
    this.pullRun = 0;
  }

  private drift(baseline: SonarBaseline, mag: Float32Array, guardEnergy: number): void {
    const a = DRIFT_ALPHA;
    for (let t = 0; t < TONE_IDS.length; t++) {
      const id = TONE_IDS[t];
      const tone = this.frame.tones[id];
      const b = baseline.tones[id];
      b.leftStd = emaStd(b.leftMean, b.leftStd, tone.leftBins, a);
      b.leftMean = ema(b.leftMean, tone.leftBins, a);
      b.rightStd = emaStd(b.rightMean, b.rightStd, tone.rightBins, a);
      b.rightMean = ema(b.rightMean, tone.rightBins, a);
      b.energyStd = emaStd(b.energyMean, b.energyStd, tone.energy, a);
      b.energyMean = ema(b.energyMean, tone.energy, a);
    }
    baseline.guardStd = emaStd(baseline.guardMean, baseline.guardStd, guardEnergy, a);
    baseline.guardMean = ema(baseline.guardMean, guardEnergy, a);
    const spectrum = baseline.spectrum;
    for (let k = 0; k < spectrum.length; k++) spectrum[k] = ema(spectrum[k], mag[k], a);
  }

  private updateStatus(now: number): void {
    let next: SonarStatus = 'listening';
    if (this.blocked) next = 'too-much-motion';
    else if (now - this.lastNoise < NOISE_STATUS_HOLD_MS) next = 'noise';
    else if (now - this.lastTrigger < this.settings.cooldownMs) next = 'cooldown';
    this.setStatus(next);
  }

  private setStatus(status: SonarStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.emit('status', status);
  }
}
