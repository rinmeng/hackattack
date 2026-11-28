// Types for Afterlife Wi-Fi Sense (/wifi). The sample shapes match what
// scripts/wifi-sense/collector.mjs streams over SSE.

/** Where samples come from. A CSI-over-UDP source could be added here later. */
export type WifiSourceName = 'corewlan' | 'mock';

/** One reading of this Mac's own Wi-Fi link. */
export interface WifiLinkSample {
  /** ms since epoch */
  t: number;
  /** dBm, whole numbers */
  rssi: number;
  /** dBm */
  noise: number;
  /** Mbps */
  txRate: number;
  iface: string;
}

/** Sent instead of a reading when there's no interface or it isn't associated. */
export interface WifiErrorSample {
  t: number;
  error: 'not_connected';
}

export type WifiSample = WifiLinkSample | WifiErrorSample;

/** Payload of the collector's SSE `status` event. */
export interface WifiCollectorStatus {
  source: WifiSourceName;
  connected: boolean;
  gateway: string | null;
  message: string;
}

/** Response of the collector's `GET /health`. */
export interface WifiCollectorHealth {
  source: WifiSourceName;
  platform: string;
  connected: boolean;
  /** samples per second over the last 5 s */
  sampleHz: number;
  /** fresh (changed) readings per second over the last 5 s */
  distinctPerSec: number;
  lastSample: WifiSample | null;
  gateway: string | null;
}

/** Scenes the mock collector can be switched to (`POST /mock/scene?name=`). */
export type WifiMockScene = 'auto' | 'quiet' | 'inside' | 'outside' | 'shift' | 'drop';

/** How the spread of RSSI is measured. */
export type WifiScoreType = 'mad' | 'std';

export interface WifiDetectorSettings {
  /** rolling window for the spread score, ms */
  windowMs: number;
  scoreType: WifiScoreType;
  /** T >= mu + k * sigma */
  k: number;
  /** T >= outsideFactor * p95 of outside-motion score */
  outsideFactor: number;
  /** multiplies T: below 1 catches more motion, above 1 ignores more */
  thresholdScale: number;
  /** score must stay above T this long to enter MOTION, ms */
  enterHoldMs: number;
  /** score must stay below the exit ratio of T this long to return to CLEAR, ms */
  exitHoldMs: number;
}

export type WifiCalibrationStep = 'empty' | 'outside';

export interface WifiCalibration {
  /** mean score with the room empty */
  mu: number;
  /** std dev of the score with the room empty */
  sigma: number;
  /** 95th percentile of the score during outside motion; null if that step was skipped */
  p95Outside: number | null;
  /** the score settings these numbers were measured with */
  scoreType: WifiScoreType;
  windowMs: number;
  /** median RSSI and mean transmit rate at calibration, for the link-change guard */
  baselineRssi: number;
  baselineTxRate: number;
  calibratedAt: number;
}

export interface WifiCalibrationProgress {
  step: WifiCalibrationStep;
  startedAt: number;
  durationMs: number;
  elapsedMs: number;
}

/** What the big status display shows. */
export type WifiDetectorState =
  | 'UNCALIBRATED'
  | 'CALIBRATING'
  | 'CLEAR'
  | 'MOTION'
  | 'STALE'
  | 'NEEDS_RECALIBRATION'
  | 'DISCONNECTED';

export type WifiRecalibrationReason = 'link_changed' | 'settings_changed';

export type WifiEventType =
  | 'motion_start'
  | 'motion_end'
  | 'alert'
  | 'link_changed'
  | 'calibrated'
  | 'stale'
  | 'disconnected'
  | 'reconnected';

export interface WifiEvent {
  id: number;
  type: WifiEventType;
  t: number;
  /** score and threshold at that moment; null when not available */
  score: number | null;
  threshold: number | null;
  detail?: string;
}

/** A throttled copy of the detector's state, safe to put in React state. */
export interface WifiDetectorSnapshot {
  state: WifiDetectorState;
  score: number | null;
  threshold: number | null;
  rssi: number | null;
  noise: number | null;
  txRate: number | null;
  lastSampleAt: number | null;
  lastDistinctAt: number | null;
  calibration: WifiCalibration | null;
  calibrating: WifiCalibrationProgress | null;
  recalibrationReason: WifiRecalibrationReason | null;
  /** why the last calibration step failed, if it did */
  calibrationError: string | null;
}

export type WifiConnectionStatus = 'connecting' | 'open' | 'error';

export interface WifiQuietHours {
  enabled: boolean;
  /** "HH:MM", local time */
  start: string;
  end: string;
}
