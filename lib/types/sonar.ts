/** Which of the two stereo tones: L plays only on the left speaker, R only on the right. */
export type ToneId = 'L' | 'R';

/** Mode A compares burst onsets on the two tones; Mode B uses the push/pull sign. */
export type SonarMode = 'stereo' | 'pushpull';

export type FftSize = 2048 | 4096 | 8192;

export type GestureDirection = 'left' | 'right';

export type SonarStatus =
  | 'idle'
  | 'starting'
  | 'calibrating'
  | 'keep-still'
  | 'listening'
  | 'noise'
  | 'too-much-motion'
  | 'cooldown'
  | 'paused';

/** User-adjustable settings. Persisted to localStorage. */
export interface SonarSettings {
  /** Master output gain, 0 to 1. */
  masterGain: number;
  toneLHz: number;
  toneRHz: number;
  /** When on, Calibrate sweeps for the best tones and overwrites toneLHz/toneRHz. */
  autoSelectTones: boolean;
  fftSize: FftSize;
  /** Bandwidth scan threshold as a percentage of the peak amplitude. */
  bandwidthThresholdPct: number;
  /** Second-peak rule threshold as a percentage of the peak amplitude. */
  secondPeakPct: number;
  minShiftBins: number;
  minProximityZ: number;
  debounceFrames: number;
  onsetGapMs: number;
  pairWindowMs: number;
  cooldownMs: number;
  continuousMotionLimitMs: number;
  mode: SonarMode;
  invertDirection: boolean;
}

/** Settings keys whose value is a plain number (fftSize is a fixed set, so it's excluded). */
export type NumericSettingKey = Exclude<
  {
    [K in keyof SonarSettings]: SonarSettings[K] extends number ? K : never;
  }[keyof SonarSettings],
  'fftSize'
>;

export interface SonarSliderDef {
  key: NumericSettingKey;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  /** Multiplier applied before display, e.g. 100 to show a 0–1 gain as a percentage. */
  displayScale: number;
}

/** Parameters for one tone's bandwidth scan. */
export interface ToneScanParams {
  /** Bins searched either side of the expected tone bin for the actual peak. */
  peakSearchRadius: number;
  /** Furthest the scan may reach either side of the peak, in bins. */
  maxBins: number;
  /** Bandwidth threshold as a fraction of the peak amplitude. */
  thresholdFrac: number;
  /** Second-peak threshold as a fraction of the peak amplitude. */
  secondPeakFrac: number;
}

/** Output of one tone's bandwidth scan. Mutated in place every frame. */
export interface ToneScan {
  peakBin: number;
  /** Linear peak magnitude. */
  peakAmp: number;
  leftBins: number;
  rightBins: number;
  /** Sideband energy ratio: side-bin magnitude sum divided by the peak. */
  energy: number;
}

/** Stillness statistics for one tone. */
export interface ToneBaseline {
  leftMean: number;
  leftStd: number;
  rightMean: number;
  rightStd: number;
  energyMean: number;
  energyStd: number;
}

/** Everything the stillness capture measures. */
export interface SonarBaseline {
  tones: Record<ToneId, ToneBaseline>;
  guardMean: number;
  guardStd: number;
  /** Mean linear magnitude per bin during stillness. */
  spectrum: Float32Array;
}

export interface SweepCandidate {
  hz: number;
  snrDb: number;
}

export interface CalibrationResult {
  toneLHz: number;
  toneRHz: number;
  /** Whether the frequency sweep ran (false when tones were set manually). */
  swept: boolean;
  /** Per-candidate SNR from the sweep (empty when it didn't run). */
  sweep: SweepCandidate[];
  /** Mean SNR of each chosen tone during the stillness capture. */
  snrDb: Record<ToneId, number>;
  /** Set when calibration fell back or a tone is weak. */
  warning: string | null;
  baseline: SonarBaseline;
}

export type CalibrationPhase = 'idle' | 'sweep' | 'settle' | 'still' | 'done';

/** Per-frame data for one tone. Mutated in place every frame. */
export interface ToneFrame {
  toneHz: number;
  toneBin: number;
  peakBin: number;
  peakAmp: number;
  peakDb: number;
  leftBins: number;
  rightBins: number;
  dL: number;
  dR: number;
  /** Signed shift in bins, dR - dL. Positive means moving toward the laptop. */
  shiftBins: number;
  /** Velocity estimate in m/s. Positive means toward. */
  velocity: number;
  energy: number;
  zE: number;
  moving: boolean;
}

/** Per-frame data for the whole sonar. One object, mutated in place every frame. */
export interface SonarFrame {
  /** requestAnimationFrame timestamp (performance.now() timeline), ms. */
  time: number;
  sampleRate: number;
  binWidth: number;
  /** The analyser's dB spectrum for this frame (shared buffer, read it synchronously). */
  spectrumDb: Float32Array | null;
  /** Baseline mean linear magnitude per bin, or null before calibration. */
  baselineSpectrum: Float32Array | null;
  thresholdFrac: number;
  tones: Record<ToneId, ToneFrame>;
  guardZ: number;
  noise: boolean;
  /** False while calibrating or paused: the frame is for display only. */
  detecting: boolean;
}

export type GestureSource = 'sonar' | 'keyboard' | 'click';

export interface GestureEvent {
  direction: GestureDirection;
  source: GestureSource;
  /** performance.now() timeline, ms. */
  time: number;
  detail: string;
}

export type SonarLogKind =
  'trigger' | 'ambiguous' | 'noise' | 'suppressed' | 'burst' | 'calibration' | 'info';

export interface SonarLogEntry {
  id: number;
  /** Wall-clock time, ms since epoch. */
  at: number;
  kind: SonarLogKind;
  message: string;
}

export interface SonarEventMap {
  left: GestureEvent;
  right: GestureEvent;
  motion: SonarFrame;
  status: SonarStatus;
  log: SonarLogEntry;
  calibrated: CalibrationResult;
}

export type SonarEventName = keyof SonarEventMap;

export type SonarListener<E extends SonarEventName> = (payload: SonarEventMap[E]) => void;

export type SonarSubscribe = <E extends SonarEventName>(
  event: E,
  fn: SonarListener<E>
) => () => void;

export interface SonarCounters {
  left: number;
  right: number;
  ambiguous: number;
  suppressed: number;
  /** Noise episodes (guard band tripped). */
  noise: number;
}

export interface ToneDebug {
  toneHz: number;
  peakHz: number;
  peakDb: number;
  snrDb: number | null;
  leftBins: number;
  rightBins: number;
  dL: number;
  dR: number;
  zE: number;
  velocity: number;
  moving: boolean;
}

/** Throttled (about 10 Hz) snapshot for the debug panel. */
export interface SonarDebugSnapshot {
  sampleRate: number;
  binWidth: number;
  fftSize: number;
  fps: number;
  tones: Record<ToneId, ToneDebug>;
  guardZ: number;
  track: Record<string, string>;
  calibrationPhase: CalibrationPhase;
  /** 0 to 1 while calibrating, otherwise null. */
  calibrationProgress: number | null;
}

export type SonarErrorCode =
  | 'insecure-context'
  | 'no-web-audio'
  | 'permission-denied'
  | 'no-microphone'
  | 'mic-busy'
  | 'low-sample-rate'
  | 'unknown';

export interface SonarErrorInfo {
  code: SonarErrorCode;
  title: string;
  description: string;
}

/** A problem with the browser or page context, detected before Start. */
export type SonarEnvironmentIssue =
  'ok' | 'insecure-context' | 'no-web-audio' | 'safari' | 'firefox';

/** Theme colours read from CSS variables, for drawing on canvas. */
export interface SonarThemeColors {
  foreground: string;
  muted: string;
  border: string;
  primary: string;
  toneL: string;
  toneR: string;
  destructive: string;
  font: string;
}

export interface UseSonarResult {
  status: SonarStatus;
  running: boolean;
  settings: SonarSettings;
  counters: SonarCounters;
  debug: SonarDebugSnapshot | null;
  log: SonarLogEntry[];
  calibration: CalibrationResult | null;
  /** Resolves to an error description if Start failed, otherwise null. */
  start: () => Promise<SonarErrorInfo | null>;
  stop: () => void;
  calibrate: () => void;
  updateSettings: (patch: Partial<SonarSettings>) => void;
  resetSettings: () => void;
  /** Fire LEFT or RIGHT directly, as if the gesture happened. */
  trigger: (direction: GestureDirection) => void;
  on: SonarSubscribe;
}
