/**
 * Calibration, driven one animation frame at a time by `feed()`:
 *
 * 1. sweep  (optional, about 1.4 s): play each candidate from 17 to 21 kHz on both
 *    speakers, score it by peak SNR, and pick tone R and tone L.
 * 2. settle (350 ms): switch to the chosen tones and let the analyser window flush.
 * 3. still  (3 s): record the mean and std of each tone's bandwidth, sideband energy
 *    and the guard band, plus a mean spectrum to draw as the baseline.
 *
 * Being frame-driven (rather than async) lets the visualisation keep running during
 * calibration and makes cancelling trivial.
 */
import type {
  CalibrationPhase,
  CalibrationResult,
  SonarSettings,
  SweepCandidate,
  ToneBaseline,
  ToneId,
  ToneScan,
  ToneScanParams,
} from '@/lib/types';

import type { SonarAudioEngine } from './audio-engine';
import {
  FALLBACK_TONE_L_HZ,
  FALLBACK_TONE_R_HZ,
  HIGH_FREQUENCY_WARNING,
  MAX_SCAN_HZ,
  MIN_STILLNESS_FRAMES,
  MIN_TONE_SEPARATION_HZ,
  MIN_TONE_SNR_DB,
  PEAK_SEARCH_RADIUS_BINS,
  SETTLE_MS,
  SNR_NOISE_FAR_BINS,
  SNR_NOISE_NEAR_BINS,
  STILLNESS_MS,
  SWEEP_DISCARD_MS,
  SWEEP_END_HZ,
  SWEEP_FFT_SIZE,
  SWEEP_START_HZ,
  SWEEP_STEP_HZ,
  SWEEP_STEP_MS,
  TONE_IDS,
} from './constants';
import {
  bandEnergy,
  createStats,
  freqToBin,
  guardEndHz,
  guardStartHz,
  maxScanBins,
  peakSnrDb,
  type RunningStats,
  scanTone,
  statsPush,
  statsStd,
} from './dsp';

interface ToneStats {
  left: RunningStats;
  right: RunningStats;
  energy: RunningStats;
  snrSum: number;
}

function createToneStats(): ToneStats {
  return { left: createStats(), right: createStats(), energy: createStats(), snrSum: 0 };
}

function toBaseline(stats: ToneStats): ToneBaseline {
  return {
    leftMean: stats.left.mean,
    leftStd: statsStd(stats.left),
    rightMean: stats.right.mean,
    rightStd: statsStd(stats.right),
    energyMean: stats.energy.mean,
    energyStd: statsStd(stats.energy),
  };
}

export class Calibrator {
  phase: CalibrationPhase = 'idle';
  result: CalibrationResult | null = null;

  private engine: SonarAudioEngine | null = null;
  private settings: SonarSettings | null = null;
  private startedAt = 0;
  private phaseStart = 0;
  private totalMs = 0;

  // Sweep
  private swept = false;
  private candidates: number[] = [];
  private candidateSnr = new Float32Array(0);
  private stepIndex = 0;
  private stepStart = 0;
  private stepSamples = 0;
  private scratch = new Float32Array(2 * (SNR_NOISE_FAR_BINS - SNR_NOISE_NEAR_BINS + 1));

  // Chosen tones
  private toneHz: Record<ToneId, number> = { L: 0, R: 0 };
  private warning: string | null = null;

  // Stillness
  private stillFrames = 0;
  private toneStats: Record<ToneId, ToneStats> = {
    L: createToneStats(),
    R: createToneStats(),
  };
  private guardStats = createStats();
  private spectrumSum = new Float32Array(0);
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
    thresholdFrac: 0,
    secondPeakFrac: 0,
  };

  get active(): boolean {
    return this.phase === 'sweep' || this.phase === 'settle' || this.phase === 'still';
  }

  /** Start calibrating. With `sweep` false, the tones in `settings` are kept. */
  begin(
    engine: SonarAudioEngine,
    settings: SonarSettings,
    sweep: boolean,
    now: number
  ): void {
    this.engine = engine;
    this.settings = settings;
    this.result = null;
    this.warning = null;
    this.startedAt = now;
    this.swept = sweep;
    this.toneHz = { L: settings.toneLHz, R: settings.toneRHz };

    if (sweep) {
      const candidates: number[] = [];
      for (let hz = SWEEP_START_HZ; hz <= SWEEP_END_HZ; hz += SWEEP_STEP_HZ) {
        if (hz <= engine.maxToneHz) candidates.push(hz);
      }
      this.candidates = candidates;
      this.candidateSnr = new Float32Array(candidates.length).fill(-Infinity);
    } else {
      this.candidates = [];
      this.candidateSnr = new Float32Array(0);
    }

    this.totalMs = this.candidates.length * SWEEP_STEP_MS + SETTLE_MS + STILLNESS_MS;

    if (this.candidates.length > 0) {
      engine.setFftSize(SWEEP_FFT_SIZE);
      this.stepIndex = 0;
      this.startStep(now);
      this.setPhase('sweep', now);
    } else {
      if (sweep) this.warning = HIGH_FREQUENCY_WARNING;
      this.enterSettle(now);
    }
  }

  cancel(): void {
    this.phase = 'idle';
    this.engine = null;
  }

  /** 0 to 1 while active. */
  progress(now: number): number {
    if (!this.active || this.totalMs <= 0) return this.phase === 'done' ? 1 : 0;
    return Math.min(1, (now - this.startedAt) / this.totalMs);
  }

  /** The tones in play right now (the sweep candidate while sweeping). */
  get currentTones(): Record<ToneId, number> {
    return this.toneHz;
  }

  feed(mag: Float32Array, now: number): void {
    const engine = this.engine;
    if (!engine || !this.active || mag.length === 0) return;
    const binWidth = engine.sampleRate / (mag.length * 2);

    if (this.phase === 'sweep') {
      this.feedSweep(mag, binWidth, now);
    } else if (this.phase === 'settle') {
      if (now - this.phaseStart >= SETTLE_MS) this.enterStill(mag.length, now);
    } else if (this.phase === 'still') {
      this.feedStill(mag, binWidth, now);
    }
  }

  private setPhase(phase: CalibrationPhase, now: number): void {
    this.phase = phase;
    this.phaseStart = now;
  }

  private startStep(now: number): void {
    const hz = this.candidates[this.stepIndex];
    this.engine?.setTones(hz, hz, 'glide');
    this.toneHz = { L: hz, R: hz };
    this.stepStart = now;
    this.stepSamples = 0;
  }

  private feedSweep(mag: Float32Array, binWidth: number, now: number): void {
    const elapsed = now - this.stepStart;
    if (elapsed >= SWEEP_DISCARD_MS) {
      const hz = this.candidates[this.stepIndex];
      const snr = peakSnrDb(
        mag,
        freqToBin(hz, binWidth),
        PEAK_SEARCH_RADIUS_BINS,
        SNR_NOISE_NEAR_BINS,
        SNR_NOISE_FAR_BINS,
        this.scratch
      );
      if (snr > this.candidateSnr[this.stepIndex])
        this.candidateSnr[this.stepIndex] = snr;
      this.stepSamples++;
    }
    // Advance only once at least one post-discard frame was scored.
    if (elapsed >= SWEEP_STEP_MS && this.stepSamples > 0) {
      this.stepIndex++;
      if (this.stepIndex < this.candidates.length) {
        this.startStep(now);
      } else {
        this.pickTones();
        this.enterSettle(now);
      }
    }
  }

  /** Tone R: highest qualifying candidate. Tone L: highest qualifying candidate at
   * least MIN_TONE_SEPARATION_HZ below it. */
  private pickTones(): void {
    const { candidates, candidateSnr } = this;
    let r = -1;
    for (let i = candidates.length - 1; i >= 0; i--) {
      if (candidateSnr[i] >= MIN_TONE_SNR_DB) {
        r = i;
        break;
      }
    }
    let l = -1;
    if (r >= 0) {
      for (let i = r - 1; i >= 0; i--) {
        if (
          candidates[r] - candidates[i] >= MIN_TONE_SEPARATION_HZ &&
          candidateSnr[i] >= MIN_TONE_SNR_DB
        ) {
          l = i;
          break;
        }
      }
    }
    if (r < 0 || l < 0) {
      this.toneHz = { L: FALLBACK_TONE_L_HZ, R: FALLBACK_TONE_R_HZ };
      this.warning = HIGH_FREQUENCY_WARNING;
    } else {
      this.toneHz = { L: candidates[l], R: candidates[r] };
    }
  }

  private enterSettle(now: number): void {
    const engine = this.engine;
    const settings = this.settings;
    if (!engine || !settings) return;
    engine.setFftSize(settings.fftSize);
    engine.setTones(this.toneHz.L, this.toneHz.R, 'dip');
    // The engine clamps to Nyquist; record what's actually playing.
    this.toneHz = { L: engine.toneLHz, R: engine.toneRHz };
    this.setPhase('settle', now);
  }

  private enterStill(bins: number, now: number): void {
    const settings = this.settings;
    if (!settings) return;
    this.stillFrames = 0;
    this.toneStats = { L: createToneStats(), R: createToneStats() };
    this.guardStats = createStats();
    this.spectrumSum = new Float32Array(bins);
    this.scanParams.thresholdFrac = settings.bandwidthThresholdPct / 100;
    this.scanParams.secondPeakFrac = settings.secondPeakPct / 100;
    this.setPhase('still', now);
  }

  private feedStill(mag: Float32Array, binWidth: number, now: number): void {
    if (mag.length !== this.spectrumSum.length) {
      // FFT size changed under us: start the capture again.
      this.enterStill(mag.length, now);
      return;
    }
    this.scanParams.maxBins = maxScanBins(MAX_SCAN_HZ, binWidth);

    for (let t = 0; t < TONE_IDS.length; t++) {
      const id = TONE_IDS[t];
      const toneBin = freqToBin(this.toneHz[id], binWidth);
      scanTone(mag, toneBin, this.scanParams, this.scan);
      const stats = this.toneStats[id];
      statsPush(stats.left, this.scan.leftBins);
      statsPush(stats.right, this.scan.rightBins);
      statsPush(stats.energy, this.scan.energy);
      stats.snrSum += peakSnrDb(
        mag,
        toneBin,
        PEAK_SEARCH_RADIUS_BINS,
        SNR_NOISE_NEAR_BINS,
        SNR_NOISE_FAR_BINS,
        this.scratch
      );
    }

    const guardLo = freqToBin(guardStartHz(this.toneHz.L), binWidth);
    const guardHi = freqToBin(guardEndHz(this.toneHz.L), binWidth);
    statsPush(this.guardStats, bandEnergy(mag, guardLo, guardHi));

    for (let k = 0; k < mag.length; k++) this.spectrumSum[k] += mag[k];
    this.stillFrames++;

    if (
      now - this.phaseStart >= STILLNESS_MS &&
      this.stillFrames >= MIN_STILLNESS_FRAMES
    ) {
      this.finish();
    }
  }

  private finish(): void {
    const frames = this.stillFrames;
    const spectrum = new Float32Array(this.spectrumSum.length);
    for (let k = 0; k < spectrum.length; k++) spectrum[k] = this.spectrumSum[k] / frames;

    const snrDb: Record<ToneId, number> = {
      L: this.toneStats.L.snrSum / frames,
      R: this.toneStats.R.snrSum / frames,
    };

    let warning = this.warning;
    if (!warning) {
      for (const id of TONE_IDS) {
        if (snrDb[id] < MIN_TONE_SNR_DB) {
          warning = `Tone ${id} at ${Math.round(this.toneHz[id])} Hz is weak (${snrDb[
            id
          ].toFixed(
            1
          )} dB SNR, ${MIN_TONE_SNR_DB} dB or more works best). ${HIGH_FREQUENCY_WARNING}`;
          break;
        }
      }
    }

    const sweep: SweepCandidate[] = this.candidates.map((hz, i) => ({
      hz,
      snrDb: this.candidateSnr[i],
    }));

    this.result = {
      toneLHz: this.toneHz.L,
      toneRHz: this.toneHz.R,
      swept: this.swept && this.candidates.length > 0,
      sweep,
      snrDb,
      warning,
      baseline: {
        tones: { L: toBaseline(this.toneStats.L), R: toBaseline(this.toneStats.R) },
        guardMean: this.guardStats.mean,
        guardStd: statsStd(this.guardStats),
        spectrum,
      },
    };
    this.phase = 'done';
    this.engine = null;
  }
}
