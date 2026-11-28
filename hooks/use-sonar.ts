'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

import type {
  CalibrationResult,
  GestureDirection,
  SonarCounters,
  SonarDebugSnapshot,
  SonarErrorInfo,
  SonarEventName,
  SonarListener,
  SonarLogEntry,
  SonarSettings,
  SonarStatus,
  ToneDebug,
  ToneId,
  UseSonarResult,
} from '@/lib/types';
import { SonarAudioEngine, SonarError } from '@/lib/sonar/audio-engine';
import { Calibrator } from '@/lib/sonar/calibrator';
import {
  DEBUG_SNAPSHOT_INTERVAL_MS,
  DEFAULT_SETTINGS,
  ERROR_MESSAGES,
  LOG_CAPACITY,
  RECAPTURE_DELAY_MS,
  RESUME_SETTLE_MS,
} from '@/lib/sonar/constants';
import { GestureDetector } from '@/lib/sonar/gesture-detector';
import {
  getServerSettingsSnapshot,
  getSettingsSnapshot,
  sanitizeSettings,
  subscribeSettings,
  writeSettings,
} from '@/lib/sonar/settings-store';

/** Elements that use the arrow keys themselves, so arrows there aren't gestures. */
const ARROW_KEY_OWNERS =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="slider"], [role="combobox"], [role="listbox"], [role="option"], [role="tab"], [role="menu"], [role="menuitem"]';

const EMPTY_COUNTERS: SonarCounters = {
  left: 0,
  right: 0,
  ambiguous: 0,
  suppressed: 0,
  noise: 0,
};

/** One running sonar: everything that exists between Start and Stop. */
interface Session {
  engine: SonarAudioEngine;
  calibrator: Calibrator;
  raf: number;
  recaptureTimer: number;
  hidden: boolean;
  /** Calibration was interrupted (tab hidden) and should rerun with this sweep flag. */
  resumeCalibration: boolean | null;
  lastSweep: boolean;
  snr: Record<ToneId, number> | null;
  lastSnapshot: number;
  fps: number;
  fpsFrames: number;
  fpsWindowStart: number;
}

interface ControllerUi {
  setRunning: (running: boolean) => void;
  setDebug: (snapshot: SonarDebugSnapshot | null) => void;
}

function toErrorInfo(error: unknown): SonarErrorInfo {
  const code = error instanceof SonarError ? error.code : 'unknown';
  return { code, ...ERROR_MESSAGES[code] };
}

/**
 * Imperative sonar controller. Lives outside React state: the per-frame loop runs on
 * requestAnimationFrame and only pushes low-rate values (running flag, a 10 Hz debug
 * snapshot) into React. Status, log and gesture events flow through the detector's
 * event emitter.
 */
function createController(ui: ControllerUi) {
  const detector = new GestureDetector();
  let settings: SonarSettings = DEFAULT_SETTINGS;
  let session: Session | null = null;
  let startToken = 0;

  function buildSnapshot(s: Session, now: number): SonarDebugSnapshot {
    const frame = detector.frame;
    const tone = (id: ToneId): ToneDebug => {
      const t = frame.tones[id];
      return {
        toneHz: t.toneHz,
        peakHz: t.peakBin * frame.binWidth,
        peakDb: t.peakDb,
        snrDb: s.snr ? s.snr[id] : null,
        leftBins: t.leftBins,
        rightBins: t.rightBins,
        dL: t.dL,
        dR: t.dR,
        zE: t.zE,
        velocity: t.velocity,
        moving: t.moving,
      };
    };
    return {
      sampleRate: s.engine.sampleRate,
      binWidth: frame.binWidth,
      fftSize: s.engine.fftSize,
      fps: s.fps,
      tones: { L: tone('L'), R: tone('R') },
      guardZ: frame.guardZ,
      track: s.engine.trackSettings,
      calibrationPhase: s.calibrator.phase,
      calibrationProgress: s.calibrator.active ? s.calibrator.progress(now) : null,
    };
  }

  function tick(now: number): void {
    const s = session;
    if (!s) return;
    s.raf = window.requestAnimationFrame(tick);
    if (s.hidden) return;

    const { engine, calibrator } = s;
    engine.readSpectrum();
    const mag = engine.magnitudes;
    const db = engine.decibels;

    if (calibrator.active) {
      calibrator.feed(mag, now);
      detector.process(mag, db, now, engine.toneLHz, engine.toneRHz, false);
      const phase = calibrator.phase;
      if (
        (phase === 'settle' || phase === 'still') &&
        detector.getStatus() !== 'keep-still'
      ) {
        detector.setPhase('keep-still');
      }
      if (phase === 'done') finishCalibration(s, now);
    } else {
      detector.process(mag, db, now, engine.toneLHz, engine.toneRHz, true);
    }

    s.fpsFrames++;
    if (now - s.fpsWindowStart >= 1000) {
      s.fps = (s.fpsFrames * 1000) / (now - s.fpsWindowStart);
      s.fpsFrames = 0;
      s.fpsWindowStart = now;
    }
    if (now - s.lastSnapshot >= DEBUG_SNAPSHOT_INTERVAL_MS) {
      s.lastSnapshot = now;
      ui.setDebug(buildSnapshot(s, now));
    }
  }

  function beginCalibration(s: Session, sweep: boolean): void {
    window.clearTimeout(s.recaptureTimer);
    s.lastSweep = sweep;
    s.resumeCalibration = null;
    detector.clearBaseline();
    s.calibrator.begin(s.engine, settings, sweep, performance.now());
    detector.setPhase(s.calibrator.phase === 'sweep' ? 'calibrating' : 'keep-still');
    detector.log(
      'calibration',
      s.calibrator.phase === 'sweep'
        ? 'Sweeping 17–21 kHz to pick the tones'
        : 'Capturing stillness, keep still'
    );
  }

  function finishCalibration(s: Session, now: number): void {
    const result = s.calibrator.result;
    if (!result) return;
    s.snr = result.snrDb;

    if (
      result.swept &&
      (result.toneLHz !== settings.toneLHz || result.toneRHz !== settings.toneRHz)
    ) {
      settings = { ...settings, toneLHz: result.toneLHz, toneRHz: result.toneRHz };
      detector.updateSettings(settings);
      writeSettings(settings);
    }

    detector.log(
      'calibration',
      `Calibrated: L ${Math.round(result.toneLHz)} Hz (${result.snrDb.L.toFixed(
        1
      )} dB), R ${Math.round(result.toneRHz)} Hz (${result.snrDb.R.toFixed(1)} dB)`
    );
    if (result.warning) detector.log('calibration', result.warning);
    detector.setPhase('listening');
    detector.applyCalibration(result, now);
    // Settings may have changed while calibrating.
    syncEngine(s);
  }

  /** Push tone and FFT settings to the engine; recapture stillness if they changed. */
  function syncEngine(s: Session): void {
    const fftChanged = s.engine.fftSize !== settings.fftSize;
    if (fftChanged) s.engine.setFftSize(settings.fftSize);
    const tonesChanged = s.engine.setTones(settings.toneLHz, settings.toneRHz, 'dip');
    if (!fftChanged && !tonesChanged) return;

    detector.clearBaseline();
    detector.setPhase('calibrating');
    window.clearTimeout(s.recaptureTimer);
    s.recaptureTimer = window.setTimeout(() => {
      if (session === s && !s.hidden) beginCalibration(s, false);
    }, RECAPTURE_DELAY_MS);
  }

  async function start(): Promise<SonarErrorInfo | null> {
    if (session) return null;
    const token = ++startToken;
    detector.setPhase('starting');
    const engine = new SonarAudioEngine();

    try {
      await engine.start({
        toneLHz: settings.toneLHz,
        toneRHz: settings.toneRHz,
        masterGain: settings.masterGain,
        fftSize: settings.fftSize,
      });
    } catch (error) {
      // Stopped or unmounted while waiting: nothing to report.
      if (token !== startToken) return null;
      detector.setPhase('idle');
      const info = toErrorInfo(error);
      detector.log('info', `Start failed: ${info.title}`);
      return info;
    }

    // Stopped or unmounted while waiting for the mic permission.
    if (token !== startToken) {
      void engine.stop();
      return null;
    }

    detector.setSampleRate(engine.sampleRate);
    const now = performance.now();
    const s: Session = {
      engine,
      calibrator: new Calibrator(),
      raf: 0,
      recaptureTimer: 0,
      hidden: false,
      resumeCalibration: null,
      lastSweep: settings.autoSelectTones,
      snr: null,
      lastSnapshot: 0,
      fps: 0,
      fpsFrames: 0,
      fpsWindowStart: now,
    };
    session = s;
    ui.setRunning(true);
    detector.log('info', `Started at ${engine.sampleRate} Hz`);
    s.raf = window.requestAnimationFrame(tick);
    beginCalibration(s, settings.autoSelectTones);
    if (document.hidden) setHidden(true);
    return null;
  }

  function stop(): void {
    startToken++;
    const s = session;
    if (!s) {
      if (detector.getStatus() === 'starting') detector.setPhase('idle');
      return;
    }
    session = null;
    window.cancelAnimationFrame(s.raf);
    window.clearTimeout(s.recaptureTimer);
    s.calibrator.cancel();
    void s.engine.stop();
    detector.clearBaseline();
    detector.setPhase('idle');
    detector.log('info', 'Stopped');
    ui.setRunning(false);
    ui.setDebug(null);
  }

  function calibrate(): void {
    const s = session;
    if (!s || s.hidden) return;
    beginCalibration(s, settings.autoSelectTones);
  }

  function applySettings(next: SonarSettings): void {
    settings = next;
    detector.updateSettings(next);
    const s = session;
    if (!s) return;
    s.engine.setMasterGain(next.masterGain);
    // The calibrator owns the tones and FFT size while it runs.
    if (!s.calibrator.active) syncEngine(s);
  }

  /** Tab hidden: mute and pause. Visible again: unmute and resume. */
  function setHidden(hidden: boolean): void {
    const s = session;
    if (!s || s.hidden === hidden) return;
    s.hidden = hidden;
    s.engine.setMuted(hidden);
    const now = performance.now();

    if (hidden) {
      if (s.calibrator.active) {
        s.calibrator.cancel();
        s.resumeCalibration = s.lastSweep;
      }
      window.clearTimeout(s.recaptureTimer);
      detector.setPhase('paused');
      detector.log('info', 'Tab hidden: paused and muted');
      return;
    }

    detector.log('info', 'Tab visible: resumed');
    if (s.resumeCalibration !== null) {
      beginCalibration(s, s.resumeCalibration);
    } else if (detector.hasBaseline) {
      detector.setPhase('listening');
      detector.resetTracking(now);
      detector.ignoreFramesUntil(now + RESUME_SETTLE_MS, now);
    } else {
      beginCalibration(s, false);
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const target = event.target;
      const ownedByWidget = target instanceof Element && target.closest(ARROW_KEY_OWNERS);
      if (
        event.repeat ||
        ownedByWidget ||
        event.altKey ||
        event.metaKey ||
        event.ctrlKey
      ) {
        return;
      }
      event.preventDefault();
      detector.manualTrigger(
        event.key === 'ArrowLeft' ? 'left' : 'right',
        'keyboard',
        performance.now()
      );
      return;
    }
    detector.noteKeydown(performance.now());
  }

  function on<E extends SonarEventName>(event: E, fn: SonarListener<E>): () => void {
    return detector.on(event, fn);
  }

  function trigger(direction: GestureDirection): void {
    detector.manualTrigger(direction, 'click', performance.now());
  }

  return {
    detector,
    start,
    stop,
    calibrate,
    applySettings,
    setHidden,
    handleKeydown,
    on,
    trigger,
  };
}

function updateSettings(patch: Partial<SonarSettings>): void {
  writeSettings(sanitizeSettings({ ...getSettingsSnapshot(), ...patch }));
}

function resetSettings(): void {
  writeSettings(DEFAULT_SETTINGS);
}

/**
 * Owns the sonar's lifecycle: the audio engine is created on Start and torn down on
 * Stop or unmount (which releases the mic). Exposes low-rate state for rendering and
 * `on(event, fn)` for per-frame data and gestures.
 */
export function useSonar(): UseSonarResult {
  const settings = useSyncExternalStore(
    subscribeSettings,
    getSettingsSnapshot,
    getServerSettingsSnapshot
  );
  const [running, setRunning] = useState(false);
  const [debug, setDebug] = useState<SonarDebugSnapshot | null>(null);
  const [status, setStatus] = useState<SonarStatus>('idle');
  const [counters, setCounters] = useState<SonarCounters>(EMPTY_COUNTERS);
  const [log, setLog] = useState<SonarLogEntry[]>([]);
  const [calibration, setCalibration] = useState<CalibrationResult | null>(null);
  const [controller] = useState(() => createController({ setRunning, setDebug }));

  useEffect(() => {
    controller.applySettings(settings);
  }, [controller, settings]);

  // Detector events into React state. These fire at low rates (status changes, log
  // lines, gestures), never per frame.
  useEffect(() => {
    const offs = [
      controller.on('status', setStatus),
      controller.on('log', (entry) => {
        setLog((prev) => [entry, ...prev].slice(0, LOG_CAPACITY));
        if (
          entry.kind === 'ambiguous' ||
          entry.kind === 'suppressed' ||
          entry.kind === 'noise'
        ) {
          const key = entry.kind === 'noise' ? 'noise' : entry.kind;
          setCounters((prev) => ({ ...prev, [key]: prev[key] + 1 }));
        }
      }),
      controller.on('left', () =>
        setCounters((prev) => ({ ...prev, left: prev.left + 1 }))
      ),
      controller.on('right', () =>
        setCounters((prev) => ({ ...prev, right: prev.right + 1 }))
      ),
      controller.on('calibrated', setCalibration),
    ];
    return () => offs.forEach((off) => off());
  }, [controller]);

  // Keyboard, tab visibility, and teardown on unmount (releases the mic).
  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => controller.handleKeydown(event);
    const onVisibility = () => controller.setHidden(document.hidden);
    window.addEventListener('keydown', onKeydown);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKeydown);
      document.removeEventListener('visibilitychange', onVisibility);
      controller.stop();
    };
  }, [controller]);

  return {
    status,
    running,
    settings,
    counters,
    debug,
    log,
    calibration,
    start: controller.start,
    stop: controller.stop,
    calibrate: controller.calibrate,
    updateSettings,
    resetSettings,
    trigger: controller.trigger,
    on: controller.on,
  };
}
