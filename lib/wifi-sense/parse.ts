// Validates what the collector sends. The collector is ours, but it's still input
// from outside the page, so nothing is trusted without checking.

import type {
  WifiCollectorHealth,
  WifiCollectorStatus,
  WifiSample,
  WifiSourceName,
} from '@/lib/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSource(value: unknown): value is WifiSourceName {
  return value === 'corewlan' || value === 'mock';
}

function safeParse(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function toSample(value: unknown): WifiSample | null {
  if (!isRecord(value) || typeof value.t !== 'number') return null;
  if (value.error === 'not_connected') return { t: value.t, error: 'not_connected' };
  const { t, rssi, noise, txRate, iface } = value;
  if (
    typeof rssi === 'number' &&
    typeof noise === 'number' &&
    typeof txRate === 'number' &&
    typeof iface === 'string'
  ) {
    return { t, rssi, noise, txRate, iface };
  }
  return null;
}

export function parseSample(data: string): WifiSample | null {
  return toSample(safeParse(data));
}

export function parseStatus(data: string): WifiCollectorStatus | null {
  const v = safeParse(data);
  if (!isRecord(v) || !isSource(v.source) || typeof v.connected !== 'boolean')
    return null;
  return {
    source: v.source,
    connected: v.connected,
    gateway: typeof v.gateway === 'string' ? v.gateway : null,
    message: typeof v.message === 'string' ? v.message : '',
  };
}

export function toHealth(v: unknown): WifiCollectorHealth | null {
  if (
    !isRecord(v) ||
    !isSource(v.source) ||
    typeof v.platform !== 'string' ||
    typeof v.connected !== 'boolean' ||
    typeof v.sampleHz !== 'number' ||
    typeof v.distinctPerSec !== 'number'
  ) {
    return null;
  }
  return {
    source: v.source,
    platform: v.platform,
    connected: v.connected,
    sampleHz: v.sampleHz,
    distinctPerSec: v.distinctPerSec,
    lastSample: toSample(v.lastSample),
    gateway: typeof v.gateway === 'string' ? v.gateway : null,
  };
}
