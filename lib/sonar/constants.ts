import type {
  FftSize,
  SonarEnvironmentIssue,
  SonarErrorCode,
  SonarSettings,
  SonarSliderDef,
  ToneId,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------

/** Speed of sound in air at about 20 °C, m/s. Doppler shift = 2 * v * f0 / c. */
export const SPEED_OF_SOUND = 343;

// ---------------------------------------------------------------------------
// Audio graph
// ---------------------------------------------------------------------------

/** Requested AudioContext rate. Everything after creation uses ctx.sampleRate instead. */
export const REQUESTED_SAMPLE_RATE = 48000;

/** Below this the Nyquist limit (22.05 kHz) can't hold two tones above 17 kHz. */
export const MIN_SAMPLE_RATE = 44100;

/** Keep tones this far under Nyquist, since converters roll off right at the edge. */
export const NYQUIST_MARGIN_HZ = 1000;

/** Gain ramp for start, stop, mute and frequency changes. 50 ms avoids audible clicks. */
export const GAIN_RAMP_S = 0.05;

/** Frequency glide used during the sweep. The oscillator is phase-continuous, so a
 * short glide is click-free and fits inside an 80 ms sweep step. */
export const FREQUENCY_GLIDE_S = 0.005;

/** Extra wait after a gain ramp before oscillators stop and the context closes. */
export const STOP_GRACE_MS = 30;

/** AnalyserNode limits. -120 dB floor keeps the ultrasonic noise floor on screen. */
export const ANALYSER_MIN_DB = -120;
export const ANALYSER_MAX_DB = 0;

/** No smoothing: each frame must be independent so short bursts aren't smeared. */
export const ANALYSER_SMOOTHING = 0;

/** FFT sizes offered in settings. 4096 at 48 kHz gives 11.7 Hz bins (85 ms window). */
export const FFT_SIZES: readonly FftSize[] = [2048, 4096, 8192];

export const TONE_IDS: readonly ToneId[] = ['L', 'R'];

// ---------------------------------------------------------------------------
// Per-frame DSP (SoundWave, Gupta et al., CHI 2012)
// ---------------------------------------------------------------------------

/** The real peak may sit a bin or two off the nominal tone bin (spectral leakage). */
export const PEAK_SEARCH_RADIUS_BINS = 2;

/** Widest Doppler spread scanned either side of the peak. 400 Hz is about a 3.4 m/s
 * hand at 20 kHz, faster than any hand gesture. */
export const MAX_SCAN_HZ = 400;

/** Bins either side of the peak left out of the sideband energy sum (main lobe). */
export const ENERGY_PEAK_EXCLUSION_BINS = 1;

/** Floor for standard deviations, relative to the mean, so a near-constant baseline
 * can't produce huge z-scores from tiny fluctuations. */
export const STD_FLOOR_RELATIVE = 0.05;

/** Absolute floor for standard deviations, used when the mean is also about zero. */
export const STD_FLOOR_ABSOLUTE = 1e-4;

/** Smallest magnitude converted to dB for drawing (avoids log10(0)). */
export const MIN_LINEAR_MAGNITUDE = 1e-12;

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

/** Sweep range and step. 17 kHz is inaudible to most adults; 21 kHz is near where
 * laptop speakers and mics give out. */
export const SWEEP_START_HZ = 17000;
export const SWEEP_END_HZ = 21000;
export const SWEEP_STEP_HZ = 250;

/** Time per candidate, and the part discarded at the start while output and input
 * latency flush. */
export const SWEEP_STEP_MS = 80;
export const SWEEP_DISCARD_MS = 30;

/** FFT size used during the sweep. A 2048 window (43 ms at 48 kHz) clears the previous
 * candidate within one 80 ms step; a 4096 window (85 ms) would not. */
export const SWEEP_FFT_SIZE: FftSize = 2048;

/** SNR noise reference: median of the bins this many bins away from the peak. */
export const SNR_NOISE_NEAR_BINS = 30;
export const SNR_NOISE_FAR_BINS = 60;

/** A candidate qualifies with at least this peak SNR. */
export const MIN_TONE_SNR_DB = 25;

/** Tone L must sit at least this far below tone R so their Doppler spreads (up to
 * MAX_SCAN_HZ each side) don't overlap. */
export const MIN_TONE_SEPARATION_HZ = 1200;

/** Fallback tones when nothing qualifies. */
export const FALLBACK_TONE_L_HZ = 18500;
export const FALLBACK_TONE_R_HZ = 20000;

/** Wait after setting the final tones before stillness capture starts: covers the
 * gain dip (2 × 50 ms) plus one full 8192-point analyser window (170 ms). */
export const SETTLE_MS = 350;

/** Stillness capture length. */
export const STILLNESS_MS = 3000;

/** Stillness capture keeps going until it has at least this many frames. */
export const MIN_STILLNESS_FRAMES = 30;

/** Guard band for broadband noise (claps, keys): 16.0–16.8 kHz, below both tones. */
export const GUARD_START_HZ = 16000;
export const GUARD_END_HZ = 16800;

/** If tone L is low, the guard band ends this far below it instead. */
export const GUARD_TONE_OFFSET_HZ = 1000;

/** Drift correction: after this long with no motion, blend each frame into the
 * baseline with an exponential moving average. */
export const DRIFT_IDLE_MS = 3000;
export const DRIFT_ALPHA = 0.01;

/** After a tone or FFT change while running, wait this long before re-capturing
 * stillness, so dragging a slider doesn't restart calibration every frame. */
export const RECAPTURE_DELAY_MS = 600;

// ---------------------------------------------------------------------------
// Gating
// ---------------------------------------------------------------------------

/** Guard-band z-score above which a frame counts as broadband noise. */
export const GUARD_NOISE_Z = 4;

/** Keep the "noise" status up this long after the last noise frame, so it doesn't
 * flicker. */
export const NOISE_STATUS_HOLD_MS = 300;

/** A new noise episode is logged only after this long without noise. */
export const NOISE_LOG_GAP_MS = 1000;

/** Continuous-motion block: when either tone has moved this long, wait until both
 * have been still this long. */
export const CONTINUOUS_RELEASE_MS = 1000;

/** Doppler crosses zero each time a waving hand reverses, so for the continuous-motion
 * block a tone's motion episode survives gaps up to this long. */
export const MOTION_GAP_TOLERANCE_MS = 200;

/** Ignore frames this long after any keydown (except the arrow keys). */
export const TYPING_PAUSE_MS = 500;

/** Ignore frames this long after the tab becomes visible again, while tones ramp in. */
export const RESUME_SETTLE_MS = 300;

/** Mode B: frames of sustained push or pull needed to trigger. */
export const PUSH_PULL_FRAMES = 6;

// ---------------------------------------------------------------------------
// Defaults (SoundWave values where it gives one)
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS: SonarSettings = {
  // Loud enough for a strong echo on MacBook speakers without clipping.
  masterGain: 0.6,
  toneLHz: FALLBACK_TONE_L_HZ,
  toneRHz: FALLBACK_TONE_R_HZ,
  autoSelectTones: true,
  fftSize: 4096,
  // 10% threshold and 30% second peak from SoundWave.
  bandwidthThresholdPct: 10,
  secondPeakPct: 30,
  // 3 bins at 11.7 Hz/bin is about 35 Hz, roughly a 0.3 m/s hand at 20 kHz.
  minShiftBins: 3,
  minProximityZ: 3,
  // 4 frames (about 67 ms at 60 fps) debounce, after SoundWave.
  debounceFrames: 4,
  // Onset gap and pair window: a 20 cm-wide wave at 1–2 m/s crosses between speakers
  // in roughly 100–300 ms, so 30 ms separates real order from jitter.
  onsetGapMs: 30,
  pairWindowMs: 600,
  // 900 ms: SoundWave used 700 ms; tuning on a MacBook showed slow return strokes
  // getting through at 700.
  cooldownMs: 900,
  // A hand resetting after a gesture moves the opposite way within about a second;
  // 1200 ms covers that, measured on a MacBook in push/pull mode.
  returnLockoutMs: 1200,
  // Turning a hand around takes about 100–300 ms; a deliberate gesture usually starts
  // after a pause longer than that, so 400 ms separates the two.
  reversalGapMs: 400,
  // 4000 ms: 2500 tripped during normal back-to-back gestures on a MacBook.
  continuousMotionLimitMs: 4000,
  // Push/pull is the default: on a MacBook the mic sits too close to the middle for
  // the stereo onset order to separate left from right reliably.
  mode: 'pushpull',
  invertDirection: false,
};

/** localStorage key for settings. Versioned so a schema change can drop old data. */
export const SETTINGS_STORAGE_KEY = 'afterlife-sonar:settings:v1';

/** Slider ranges for every numeric setting. Also used to clamp loaded settings. */
export const SETTING_SLIDERS: readonly SonarSliderDef[] = [
  {
    key: 'masterGain',
    label: 'Master volume',
    min: 0,
    max: 1,
    step: 0.05,
    unit: '%',
    displayScale: 100,
  },
  {
    key: 'toneLHz',
    label: 'Tone L frequency',
    min: 15000,
    max: 22000,
    step: 50,
    unit: 'Hz',
    displayScale: 1,
  },
  {
    key: 'toneRHz',
    label: 'Tone R frequency',
    min: 15000,
    max: 22000,
    step: 50,
    unit: 'Hz',
    displayScale: 1,
  },
  {
    key: 'bandwidthThresholdPct',
    label: 'Bandwidth threshold',
    min: 2,
    max: 50,
    step: 1,
    unit: '%',
    displayScale: 1,
  },
  {
    key: 'secondPeakPct',
    label: 'Second-peak threshold',
    min: 5,
    max: 80,
    step: 1,
    unit: '%',
    displayScale: 1,
  },
  {
    key: 'minShiftBins',
    label: 'Min shift',
    min: 1,
    max: 15,
    step: 1,
    unit: 'bins',
    displayScale: 1,
  },
  {
    key: 'minProximityZ',
    label: 'Min proximity z-score',
    min: 0,
    max: 15,
    step: 0.5,
    unit: 'σ',
    displayScale: 1,
  },
  {
    key: 'debounceFrames',
    label: 'Debounce',
    min: 1,
    max: 15,
    step: 1,
    unit: 'frames',
    displayScale: 1,
  },
  {
    key: 'onsetGapMs',
    label: 'Onset gap',
    min: 0,
    max: 200,
    step: 5,
    unit: 'ms',
    displayScale: 1,
  },
  {
    key: 'pairWindowMs',
    label: 'Pair window',
    min: 100,
    max: 1500,
    step: 50,
    unit: 'ms',
    displayScale: 1,
  },
  {
    key: 'cooldownMs',
    label: 'Cooldown',
    min: 0,
    max: 3000,
    step: 50,
    unit: 'ms',
    displayScale: 1,
  },
  {
    key: 'reversalGapMs',
    label: 'Reversal gap (push/pull)',
    min: 0,
    max: 1500,
    step: 50,
    unit: 'ms',
    displayScale: 1,
  },
  {
    key: 'returnLockoutMs',
    label: 'Return-stroke lockout',
    min: 0,
    max: 3000,
    step: 50,
    unit: 'ms',
    displayScale: 1,
  },
  {
    key: 'continuousMotionLimitMs',
    label: 'Continuous-motion limit',
    min: 500,
    max: 10000,
    step: 100,
    unit: 'ms',
    displayScale: 1,
  },
];

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

/** Debug snapshot rate pushed into React state (about 10 Hz). */
export const DEBUG_SNAPSHOT_INTERVAL_MS = 100;

/** Event log length kept in memory. */
export const LOG_CAPACITY = 100;

/** LEFT/RIGHT button flash length. */
export const FLASH_MS = 300;

/** Spectrum panels show this far either side of each tone. */
export const SPECTRUM_SPAN_HZ = 500;

/** Spectrum x-axis tick spacing. */
export const SPECTRUM_TICK_HZ = 250;

/** Spectrum y-axis range and grid spacing, dB. */
export const SPECTRUM_MIN_DB = ANALYSER_MIN_DB;
export const SPECTRUM_MAX_DB = ANALYSER_MAX_DB;
export const SPECTRUM_GRID_DB = 20;

/** Velocity trace length and range. */
export const TRACE_WINDOW_MS = 5000;
export const TRACE_RANGE_MPS = 1.5;
export const TRACE_GRID_MPS = 0.5;

/** Ring buffer for the trace: 5 s at up to 120 fps (ProMotion), with headroom. */
export const TRACE_CAPACITY = 1024;

/** Trigger markers kept on the trace. */
export const TRACE_MARKER_CAPACITY = 32;

/** Canvas plot padding, CSS px: left (room for axis labels), right, top, bottom. */
export const PLOT_PAD_LEFT = 44;
export const PLOT_PAD_RIGHT = 8;
export const PLOT_PAD_TOP = 18;
export const PLOT_PAD_BOTTOM = 22;

/** Gap between an axis and its labels, and offset of panel titles, CSS px. */
export const PLOT_LABEL_GAP = 4;
export const PLOT_TITLE_OFFSET = 2;

/** Room reserved for one legend entry on the velocity trace, CSS px. */
export const PLOT_LEGEND_WIDTH = 70;

/** Canvas label font size, CSS px. */
export const PLOT_FONT_PX = 10;

/** Opacity of shaded regions and faint lines on the canvases. */
export const PLOT_SHADE_ALPHA = 0.15;
export const PLOT_FAINT_ALPHA = 0.45;

/** Dash pattern for tone R's line, so the tones are told apart without colour. */
export const TONE_R_DASH: readonly number[] = [6, 4];

/** Dash pattern for reference lines (threshold, tone marker). */
export const REFERENCE_DASH: readonly number[] = [3, 3];

/** Line widths, CSS px. */
export const PLOT_LINE_WIDTH = 1.5;
export const PLOT_THIN_LINE_WIDTH = 1;

/** Height of the per-tone "moving" strip on the velocity trace, CSS px. */
export const TRACE_MOVING_STRIP_PX = 4;

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const HIGH_FREQUENCY_WARNING =
  'Your speakers or mic may filter high frequencies. Use Chrome, turn the volume up, unplug headphones and AirPods, and set macOS Mic Mode to Standard, not Voice Isolation.';

export interface SonarMessage {
  title: string;
  description: string;
}

/** Friendly text for each start-up failure. */
export const ERROR_MESSAGES: Record<SonarErrorCode, SonarMessage> = {
  'insecure-context': {
    title: 'Microphone unavailable on this address',
    description:
      'Browsers only allow the microphone on localhost or HTTPS. Open http://localhost:3000/sonar or an https:// URL.',
  },
  'no-web-audio': {
    title: 'Web Audio not supported',
    description: 'This browser has no Web Audio API. Use the latest Chrome.',
  },
  'permission-denied': {
    title: 'Microphone permission denied',
    description:
      'Allow the microphone from the icon in the address bar (and in macOS System Settings → Privacy & Security → Microphone), then press Start again.',
  },
  'no-microphone': {
    title: 'No microphone found',
    description:
      'Check that the built-in microphone is enabled and not disabled in macOS.',
  },
  'mic-busy': {
    title: 'Microphone is busy',
    description:
      'Another app or tab may be using the microphone. Close it and press Start again.',
  },
  'low-sample-rate': {
    title: 'Sample rate too low',
    description:
      'The audio device runs below 44.1 kHz, which cannot carry tones above 17 kHz. Set the output to 48 kHz in Audio MIDI Setup and unplug Bluetooth headsets.',
  },
  unknown: {
    title: 'Could not start the sonar',
    description: 'Something went wrong starting audio. Reload the page and try again.',
  },
};

/** Warnings shown before Start for browsers or pages that won't work. */
export const ENVIRONMENT_MESSAGES: Record<
  Exclude<SonarEnvironmentIssue, 'ok'>,
  SonarMessage
> = {
  'insecure-context': ERROR_MESSAGES['insecure-context'],
  'no-web-audio': ERROR_MESSAGES['no-web-audio'],
  safari: {
    title: "Safari won't work for this",
    description:
      'Safari low-pass filters microphone input well below 17 kHz (WebKit bug 192932), so the ultrasonic echo never arrives. Open this page in Chrome.',
  },
  firefox: {
    title: "Firefox isn't supported",
    description:
      'Firefox has historically ignored echoCancellation: false on macOS, and its echo canceller removes the tones. Open this page in Chrome.',
  },
};
