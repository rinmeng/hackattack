import type { WifiDetectorSettings, WifiQuietHours } from '@/lib/types';

// ---------------------------------------------------------------------------------
// Detector defaults
// ---------------------------------------------------------------------------------

export const DEFAULT_SETTINGS: WifiDetectorSettings = {
  // 2 s holds several fresh readings even when macOS refreshes RSSI only ~1-2 times a
  // second, and still reacts within a stride or two of someone walking.
  windowMs: 2_000,
  // Mean absolute deviation shrugs off a single odd reading better than std dev.
  scoreType: 'mad',
  // 4 sigma above the empty-room mean: rare for the room's own noise to reach.
  k: 4,
  // 20% headroom over the 95th percentile of hallway motion, so neighbours stay quiet.
  outsideFactor: 1.2,
  thresholdScale: 1,
  // 1.5 s above T before MOTION: ignores one-off blips such as a microwave or a packet burst.
  enterHoldMs: 1_500,
  // 5 s below the exit level before CLEAR: someone pausing mid-room doesn't flicker it.
  exitHoldMs: 5_000,
};

/** Score must fall below this share of T to count towards leaving MOTION (hysteresis). */
export const EXIT_RATIO = 0.7;

/** Never let T fall below this (dB). One dBm flickering in the window gives MAD <= 0.5. */
export const MIN_THRESHOLD_DB = 0.5;

/** A window needs at least this many samples before the score means anything. */
export const MIN_WINDOW_SAMPLES = 3;

/** ...and must span at least this share of its length (just after start or a reset). */
export const MIN_WINDOW_FILL = 0.8;

// ---------------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------------

/** 60 s gives ~30 independent 2 s windows: enough for a stable mean and std dev. */
export const EMPTY_CALIBRATION_MS = 60_000;
/** 60 s is a couple of walks up and down a hallway. */
export const OUTSIDE_CALIBRATION_MS = 60_000;
/** Fewer scored samples than this in a step means it didn't really run. */
export const MIN_CALIBRATION_SAMPLES = 10;
/** Percentile of the outside-motion score that T must clear. */
export const OUTSIDE_PERCENTILE = 0.95;
/** Calibration steps can be set between these lengths in the UI. */
export const CALIBRATION_MIN_MS = 15_000;
export const CALIBRATION_MAX_MS = 180_000;

// ---------------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------------

/** Median RSSI over this window is compared with the calibration baseline. */
export const LINK_WINDOW_MS = 10_000;
/** A move of the laptop or router, or a different AP, shifts the median this much. */
export const LINK_RSSI_JUMP_DB = 8;
/** Transmit rate this far off the baseline (as a ratio) means a different link. */
export const LINK_TX_RATE_JUMP_RATIO = 0.5;
/** A single reading-to-reading jump this big restarts the score window (see detector). */
export const STEP_RESET_DB = LINK_RSSI_JUMP_DB;
/** The jump must persist, with the signal calm again, this long before we call it. */
export const LINK_CHANGE_HOLD_MS = 5_000;

/** No fresh reading for this long means the data is stale, not that the room is clear. */
export const STALE_MS = 5_000;

// ---------------------------------------------------------------------------------
// Buffers
// ---------------------------------------------------------------------------------

/** 2^15 samples: 27 min at 20 Hz, and still > 120 s at the 5 ms minimum interval. */
export const RING_CAPACITY = 32_768;

/** Channels stored per sample in the ring buffer. */
export const CH_T = 0;
export const CH_RSSI = 1;
export const CH_TX_RATE = 2;
export const CH_SCORE = 3;
export const CH_THRESHOLD = 4;
/** 1 while in MOTION, 0 otherwise */
export const CH_MOTION = 5;
export const RING_CHANNELS = 6;

/** RSSI histogram range (dBm). Real links sit well inside it; values are clamped. */
export const RSSI_MIN_DBM = -120;
export const RSSI_MAX_DBM = 0;

// ---------------------------------------------------------------------------------
// Connection and UI
// ---------------------------------------------------------------------------------

export const DEFAULT_COLLECTOR_URL = 'http://127.0.0.1:4317';
export const COLLECTOR_COMMAND = 'node scripts/wifi-sense/collector.mjs';
export const COLLECTOR_MOCK_COMMAND = 'node scripts/wifi-sense/collector.mjs --mock';

/** EventSource reconnect backoff: start at 1 s, double, cap at 10 s. */
export const RECONNECT_MIN_MS = 1_000;
export const RECONNECT_MAX_MS = 10_000;
export const RECONNECT_FACTOR = 2;

/** React state gets a snapshot at most this often (~8 Hz): smooth, but cheap. */
export const SNAPSHOT_INTERVAL_MS = 125;
/** How often to poll /health for Diagnostics. */
export const HEALTH_POLL_MS = 2_000;
/** Re-check staleness even when no samples arrive. */
export const TICK_INTERVAL_MS = 500;

/** Chart shows the last 60 s. */
export const CHART_WINDOW_MS = 60_000;
/** RSSI axis never shows less than this span (dB), so a flat line isn't blown up. */
export const CHART_MIN_RSSI_SPAN_DB = 6;
/** Score axis never shows less than this (dB). */
export const CHART_MIN_SCORE_SPAN_DB = 2;
/** Share of the chart height given to the RSSI panel; the score panel gets the rest. */
export const CHART_RSSI_SHARE = 0.5;
export const CHART_HEIGHT_PX = 320;
export const CHART_PADDING_PX = 8;
export const CHART_LINE_WIDTH_PX = 1.5;
export const CHART_FONT_PX = 11;
/** Shading opacity for MOTION periods. */
export const CHART_MOTION_ALPHA = 0.18;

export const EVENT_LOG_LIMIT = 500;

/** At most one alert (toast, notification, beep) per minute. */
export const ALERT_COOLDOWN_MS = 60_000;
export const BEEP_FREQUENCY_HZ = 880;
export const BEEP_DURATION_S = 0.35;
export const BEEP_GAIN = 0.2;
/** Fade-out target: exponential ramps can't reach 0. */
export const BEEP_MIN_GAIN = 0.0001;

/** Below this many fresh readings a second, warn that detection will lag. */
export const SLOW_DISTINCT_PER_SEC = 2;

export const DEFAULT_QUIET_HOURS: WifiQuietHours = {
  enabled: true,
  start: '01:00',
  end: '05:00',
};

/** Decimals shown for scores and thresholds (dB). */
export const DISPLAY_DECIMALS = 2;
/** A gap this long between samples breaks the chart line instead of bridging it. */
export const CHART_GAP_MS = 1_500;

export const MINUTES_PER_HOUR = 60;
export const MS_PER_SECOND = 1_000;

// ---------------------------------------------------------------------------------
// Settings ranges (for sliders)
// ---------------------------------------------------------------------------------

export const SETTINGS_RANGES = {
  windowMs: { min: 1_000, max: 5_000, step: 250 },
  k: { min: 2, max: 8, step: 0.5 },
  outsideFactor: { min: 1, max: 2, step: 0.05 },
  thresholdScale: { min: 0.5, max: 2, step: 0.05 },
  enterHoldMs: { min: 500, max: 5_000, step: 250 },
  exitHoldMs: { min: 1_000, max: 20_000, step: 500 },
} as const;

// ---------------------------------------------------------------------------------
// localStorage keys
// ---------------------------------------------------------------------------------

export const STORAGE_KEYS = {
  collectorUrl: 'wifi-sense:collector-url',
  calibration: 'wifi-sense:calibration',
  settings: 'wifi-sense:settings',
  quietHours: 'wifi-sense:quiet-hours',
} as const;
