/**
 * Settings persisted to localStorage, exposed as an external store for
 * useSyncExternalStore. localStorage is touched only inside these functions, never at
 * import time, and every access is wrapped in try/catch (private mode, quota, or
 * storage disabled).
 */
import type { FftSize, SonarMode, SonarSettings } from '@/lib/types';

import {
  DEFAULT_SETTINGS,
  FFT_SIZES,
  SETTING_SLIDERS,
  SETTINGS_STORAGE_KEY,
} from './constants';

let cached: SonarSettings | null = null;
const listeners = new Set<() => void>();

function pick(source: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(source, key)
    ? Object.getOwnPropertyDescriptor(source, key)?.value
    : undefined;
}

/** Turn anything (parsed JSON, a partial object) into valid settings, clamping numbers
 * to their slider ranges and falling back to defaults. */
export function sanitizeSettings(raw: unknown): SonarSettings {
  const next: SonarSettings = { ...DEFAULT_SETTINGS };
  if (typeof raw !== 'object' || raw === null) return next;

  for (const def of SETTING_SLIDERS) {
    const value = pick(raw, def.key);
    if (typeof value === 'number' && Number.isFinite(value)) {
      next[def.key] = Math.min(def.max, Math.max(def.min, value));
    }
  }

  const fft = pick(raw, 'fftSize');
  const fftMatch: FftSize | undefined = FFT_SIZES.find((size) => size === fft);
  if (fftMatch) next.fftSize = fftMatch;

  const mode = pick(raw, 'mode');
  const modes: readonly SonarMode[] = ['stereo', 'pushpull'];
  const modeMatch = modes.find((m) => m === mode);
  if (modeMatch) next.mode = modeMatch;

  const invert = pick(raw, 'invertDirection');
  if (typeof invert === 'boolean') next.invertDirection = invert;
  const auto = pick(raw, 'autoSelectTones');
  if (typeof auto === 'boolean') next.autoSelectTones = auto;

  return next;
}

function load(): SonarSettings {
  try {
    const text = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!text) return DEFAULT_SETTINGS;
    const parsed: unknown = JSON.parse(text);
    return sanitizeSettings(parsed);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function getSettingsSnapshot(): SonarSettings {
  if (cached === null) cached = load();
  return cached;
}

export function getServerSettingsSnapshot(): SonarSettings {
  return DEFAULT_SETTINGS;
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function writeSettings(next: SonarSettings): void {
  cached = next;
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: settings still apply for this session.
  }
  listeners.forEach((listener) => listener());
}
