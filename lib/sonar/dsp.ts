/**
 * Pure signal-processing helpers for the sonar. No DOM, no Web Audio: every function
 * here takes numbers or typed arrays and returns numbers (or writes into an output
 * object you pass in), so it's safe to call in the per-frame loop without allocating.
 */
import type { ToneScan, ToneScanParams } from '@/lib/types';

import {
  ENERGY_PEAK_EXCLUSION_BINS,
  GUARD_END_HZ,
  GUARD_START_HZ,
  GUARD_TONE_OFFSET_HZ,
  MIN_LINEAR_MAGNITUDE,
  SPEED_OF_SOUND,
  STD_FLOOR_ABSOLUTE,
  STD_FLOOR_RELATIVE,
} from './constants';

/** dB to linear magnitude: 10^(dB / 20). -Infinity becomes 0. */
export function dbToLinear(db: number): number {
  return 10 ** (db / 20);
}

/** Linear magnitude to dB, clamped so 0 doesn't become -Infinity. */
export function linearToDb(mag: number): number {
  return 20 * Math.log10(Math.max(mag, MIN_LINEAR_MAGNITUDE));
}

/** Convert a whole dB spectrum into linear magnitudes, in place into `out`. */
export function dbArrayToLinear(db: Float32Array, out: Float32Array): void {
  const n = Math.min(db.length, out.length);
  for (let i = 0; i < n; i++) {
    out[i] = 10 ** (db[i] / 20);
  }
}

/** Width of one FFT bin, Hz. */
export function getBinWidth(sampleRate: number, fftSize: number): number {
  return sampleRate / fftSize;
}

/** Bin index nearest to frequency `hz`. */
export function freqToBin(hz: number, binWidth: number): number {
  return Math.round(hz / binWidth);
}

export function binToFreq(bin: number, binWidth: number): number {
  return bin * binWidth;
}

/** Most bins the bandwidth scan may cover on one side, for a given Hz limit. */
export function maxScanBins(maxHz: number, binWidth: number): number {
  return Math.ceil(maxHz / binWidth);
}

/** Index of the largest magnitude within ±radius of `center`, clamped to the array. */
export function findPeak(mag: Float32Array, center: number, radius: number): number {
  const lo = Math.max(0, center - radius);
  const hi = Math.min(mag.length - 1, center + radius);
  let best = lo;
  for (let i = lo + 1; i <= hi; i++) {
    if (mag[i] > mag[best]) best = i;
  }
  return best;
}

/**
 * SoundWave's bandwidth scan for one side of a peak.
 *
 * Step outward from the peak while the magnitude stays above `thresholdFrac` of the
 * peak. When the scan stops, apply the second-peak rule: if any bin further out (still
 * within `maxBins`) reaches `secondPeakFrac` of the peak, jump to it and keep scanning
 * from there. A fast hand reflects a separate Doppler peak that a plain threshold scan
 * would stop short of.
 *
 * Returns how many bins from the peak the scanned bandwidth reaches (0 = none).
 */
export function scanSide(
  mag: Float32Array,
  peakBin: number,
  peakAmp: number,
  direction: 1 | -1,
  maxBins: number,
  thresholdFrac: number,
  secondPeakFrac: number
): number {
  const threshold = peakAmp * thresholdFrac;
  const secondPeak = peakAmp * secondPeakFrac;
  const n = mag.length;
  let extent = 0;
  let i = 1;

  while (i <= maxBins) {
    const k = peakBin + direction * i;
    if (k < 0 || k >= n) break;
    if (mag[k] > threshold) {
      extent = i;
      i++;
      continue;
    }

    // Scan stopped here. Look further out for a second peak.
    let jump = -1;
    for (let j = i + 1; j <= maxBins; j++) {
      const kj = peakBin + direction * j;
      if (kj < 0 || kj >= n) break;
      if (mag[kj] >= secondPeak) {
        jump = j;
        break;
      }
    }
    if (jump < 0) break;
    extent = jump;
    i = jump + 1;
  }

  return extent;
}

/**
 * Sideband energy ratio: the sum of linear magnitudes across the scanned side bins,
 * leaving out the peak's main lobe (±`exclusion` bins), divided by the peak amplitude.
 * A hand close to the laptop reflects much more energy than a person across the room.
 */
export function sidebandEnergy(
  mag: Float32Array,
  peakBin: number,
  peakAmp: number,
  leftBins: number,
  rightBins: number,
  exclusion: number
): number {
  if (peakAmp <= 0) return 0;
  const lo = Math.max(0, peakBin - leftBins);
  const hi = Math.min(mag.length - 1, peakBin + rightBins);
  let sum = 0;
  for (let k = lo; k <= hi; k++) {
    if (Math.abs(k - peakBin) > exclusion) sum += mag[k];
  }
  return sum / peakAmp;
}

/** Find one tone's peak and scan its bandwidth on both sides. Writes into `out`. */
export function scanTone(
  mag: Float32Array,
  toneBin: number,
  params: ToneScanParams,
  out: ToneScan
): void {
  const peakBin = findPeak(mag, toneBin, params.peakSearchRadius);
  const peakAmp = mag[peakBin] ?? 0;
  const leftBins = scanSide(
    mag,
    peakBin,
    peakAmp,
    -1,
    params.maxBins,
    params.thresholdFrac,
    params.secondPeakFrac
  );
  const rightBins = scanSide(
    mag,
    peakBin,
    peakAmp,
    1,
    params.maxBins,
    params.thresholdFrac,
    params.secondPeakFrac
  );
  out.peakBin = peakBin;
  out.peakAmp = peakAmp;
  out.leftBins = leftBins;
  out.rightBins = rightBins;
  out.energy = sidebandEnergy(
    mag,
    peakBin,
    peakAmp,
    leftBins,
    rightBins,
    ENERGY_PEAK_EXCLUSION_BINS
  );
}

/** Mean linear magnitude over bins [startBin, endBin]. */
export function bandEnergy(mag: Float32Array, startBin: number, endBin: number): number {
  const lo = Math.max(0, startBin);
  const hi = Math.min(mag.length - 1, endBin);
  if (hi < lo) return 0;
  let sum = 0;
  for (let k = lo; k <= hi; k++) sum += mag[k];
  return sum / (hi - lo + 1);
}

/** Guard band start: 16.0 kHz, or lower if tone L sits close to it. */
export function guardStartHz(toneLHz: number): number {
  return guardEndHz(toneLHz) - (GUARD_END_HZ - GUARD_START_HZ);
}

/** Guard band end: 16.8 kHz, or 1 kHz below tone L if that's lower. */
export function guardEndHz(toneLHz: number): number {
  return Math.min(GUARD_END_HZ, toneLHz - GUARD_TONE_OFFSET_HZ);
}

/**
 * Peak SNR in dB: the largest magnitude within ±peakRadius of `center`, against the
 * median magnitude of the bins `near` to `far` bins away on both sides. `scratch` must
 * hold at least 2 * (far - near + 1) values.
 */
export function peakSnrDb(
  mag: Float32Array,
  center: number,
  peakRadius: number,
  near: number,
  far: number,
  scratch: Float32Array
): number {
  const peak = mag[findPeak(mag, center, peakRadius)] ?? 0;
  let count = 0;
  for (let d = near; d <= far; d++) {
    const lo = center - d;
    const hi = center + d;
    if (lo >= 0 && count < scratch.length) scratch[count++] = mag[lo];
    if (hi < mag.length && count < scratch.length) scratch[count++] = mag[hi];
  }
  if (count === 0) return 0;
  const sorted = scratch.subarray(0, count).sort();
  const median =
    count % 2 === 1
      ? sorted[(count - 1) / 2]
      : (sorted[count / 2 - 1] + sorted[count / 2]) / 2;
  return linearToDb(peak) - linearToDb(median);
}

/** Velocity in m/s from a signed shift in bins: v = Δf * c / (2 * f0). */
export function shiftToVelocity(shiftBins: number, binWidth: number, f0: number): number {
  if (f0 <= 0) return 0;
  return (shiftBins * binWidth * SPEED_OF_SOUND) / (2 * f0);
}

/** Standard deviation with a floor, so a near-constant baseline can't explode z. */
export function flooredStd(std: number, mean: number): number {
  return Math.max(std, Math.abs(mean) * STD_FLOOR_RELATIVE, STD_FLOOR_ABSOLUTE);
}

export function zScore(x: number, mean: number, std: number): number {
  return (x - mean) / flooredStd(std, mean);
}

/** Exponential moving average step. */
export function ema(previous: number, sample: number, alpha: number): number {
  return previous + alpha * (sample - previous);
}

/** Running mean and variance (Welford). Mutate with statsPush. */
export interface RunningStats {
  count: number;
  mean: number;
  m2: number;
}

export function createStats(): RunningStats {
  return { count: 0, mean: 0, m2: 0 };
}

export function statsPush(stats: RunningStats, x: number): void {
  stats.count += 1;
  const delta = x - stats.mean;
  stats.mean += delta / stats.count;
  stats.m2 += delta * (x - stats.mean);
}

export function statsStd(stats: RunningStats): number {
  return stats.count > 1 ? Math.sqrt(stats.m2 / (stats.count - 1)) : 0;
}

/** Blend a sample into a mean/std pair with an EMA. Returns the new std; the new mean
 * is ema(mean, sample, alpha). */
export function emaStd(mean: number, std: number, sample: number, alpha: number): number {
  const delta = sample - mean;
  const variance = (1 - alpha) * (std * std + alpha * delta * delta);
  return Math.sqrt(variance);
}
