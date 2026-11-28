// localStorage for Afterlife Wi-Fi Sense. Browser only: call these from effects or
// event handlers, never at module level or during render. Every read is validated,
// since anything could be in storage, and every access is wrapped in try/catch
// (private mode, full quota, disabled storage).

import type {
  WifiCalibration,
  WifiDetectorSettings,
  WifiQuietHours,
  WifiScoreType,
} from '@/lib/types';
import {
  DEFAULT_COLLECTOR_URL,
  DEFAULT_QUIET_HOURS,
  DEFAULT_SETTINGS,
  SETTINGS_RANGES,
  STORAGE_KEYS,
} from '@/lib/wifi-sense/constants';
import { parseClock } from '@/lib/wifi-sense/quiet-hours';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScoreType(value: unknown): value is WifiScoreType {
  return value === 'mad' || value === 'std';
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the app still works, it just won't remember.
  }
}

function remove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

/** A collector URL we're willing to connect to: http(s), no path. */
export function normalizeCollectorUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function loadCollectorUrl(): string {
  const value = readJson(STORAGE_KEYS.collectorUrl);
  return (
    (typeof value === 'string' && normalizeCollectorUrl(value)) || DEFAULT_COLLECTOR_URL
  );
}

export function saveCollectorUrl(url: string): void {
  writeJson(STORAGE_KEYS.collectorUrl, url);
}

export function loadCalibration(): WifiCalibration | null {
  const v = readJson(STORAGE_KEYS.calibration);
  if (!isRecord(v)) return null;
  const mu = finite(v.mu);
  const sigma = finite(v.sigma);
  const windowMs = finite(v.windowMs);
  const baselineRssi = finite(v.baselineRssi);
  const baselineTxRate = finite(v.baselineTxRate);
  const calibratedAt = finite(v.calibratedAt);
  const p95Outside = v.p95Outside === null ? null : finite(v.p95Outside);
  if (
    mu === null ||
    sigma === null ||
    windowMs === null ||
    baselineRssi === null ||
    baselineTxRate === null ||
    calibratedAt === null ||
    (v.p95Outside !== null && p95Outside === null) ||
    !isScoreType(v.scoreType)
  ) {
    return null;
  }
  return {
    mu,
    sigma,
    p95Outside,
    scoreType: v.scoreType,
    windowMs,
    baselineRssi,
    baselineTxRate,
    calibratedAt,
  };
}

export function saveCalibration(calibration: WifiCalibration | null): void {
  if (calibration) writeJson(STORAGE_KEYS.calibration, calibration);
  else remove(STORAGE_KEYS.calibration);
}

type NumericSetting = keyof typeof SETTINGS_RANGES;
const NUMERIC_SETTINGS: readonly NumericSetting[] = [
  'windowMs',
  'k',
  'outsideFactor',
  'thresholdScale',
  'enterHoldMs',
  'exitHoldMs',
];

export function loadSettings(): WifiDetectorSettings {
  const v = readJson(STORAGE_KEYS.settings);
  const settings: WifiDetectorSettings = { ...DEFAULT_SETTINGS };
  if (!isRecord(v)) return settings;
  for (const key of NUMERIC_SETTINGS) {
    const n = finite(v[key]);
    const range = SETTINGS_RANGES[key];
    if (n !== null && n >= range.min && n <= range.max) settings[key] = n;
  }
  if (isScoreType(v.scoreType)) settings.scoreType = v.scoreType;
  return settings;
}

export function saveSettings(settings: WifiDetectorSettings): void {
  writeJson(STORAGE_KEYS.settings, settings);
}

export function loadQuietHours(): WifiQuietHours {
  const v = readJson(STORAGE_KEYS.quietHours);
  if (!isRecord(v)) return { ...DEFAULT_QUIET_HOURS };
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_QUIET_HOURS.enabled,
    start:
      typeof v.start === 'string' && parseClock(v.start) !== null
        ? v.start
        : DEFAULT_QUIET_HOURS.start,
    end:
      typeof v.end === 'string' && parseClock(v.end) !== null
        ? v.end
        : DEFAULT_QUIET_HOURS.end,
  };
}

export function saveQuietHours(quietHours: WifiQuietHours): void {
  writeJson(STORAGE_KEYS.quietHours, quietHours);
}
