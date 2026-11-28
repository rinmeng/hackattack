import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  WifiCalibrationStep,
  WifiCollectorHealth,
  WifiCollectorStatus,
  WifiConnectionStatus,
  WifiDetectorSettings,
  WifiDetectorSnapshot,
  WifiEvent,
  WifiMockScene,
  WifiQuietHours,
  WifiSourceName,
} from '@/lib/types';
import {
  ALERT_COOLDOWN_MS,
  DEFAULT_COLLECTOR_URL,
  DEFAULT_QUIET_HOURS,
  DEFAULT_SETTINGS,
  EVENT_LOG_LIMIT,
  HEALTH_POLL_MS,
  RECONNECT_FACTOR,
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  SNAPSHOT_INTERVAL_MS,
} from '@/lib/wifi-sense/constants';
import { MotionDetector } from '@/lib/wifi-sense/detector';
import { parseSample, parseStatus, toHealth } from '@/lib/wifi-sense/parse';
import { isInQuietHours } from '@/lib/wifi-sense/quiet-hours';
import { DURATIONS } from '@/lib/durations';
import { useToast } from '@/hooks/use-toast';
import { playBeep } from '@/utils/wifi-sense/beep';
import {
  loadCalibration,
  loadCollectorUrl,
  loadQuietHours,
  loadSettings,
  normalizeCollectorUrl,
  saveCalibration,
  saveCollectorUrl,
  saveQuietHours,
  saveSettings,
} from '@/utils/wifi-sense/storage';

export type WifiNotificationPermission = NotificationPermission | 'unsupported';

/**
 * Runs Afterlife Wi-Fi Sense in the browser: connects to the local collector over
 * SSE (reconnecting with backoff), feeds every sample to the detector, and pushes a
 * throttled snapshot (~8 Hz) into React state. Samples themselves never touch React
 * state; the chart reads them straight from `detectorRef.current.ring`.
 */
export function useWifiSense() {
  const { toast } = useToast();

  const [ready, setReady] = useState(false);
  const [collectorUrl, setCollectorUrlState] = useState(DEFAULT_COLLECTOR_URL);
  const [settings, setSettingsState] = useState<WifiDetectorSettings>(DEFAULT_SETTINGS);
  const [quietHours, setQuietHoursState] = useState<WifiQuietHours>(DEFAULT_QUIET_HOURS);
  const [connection, setConnection] = useState<WifiConnectionStatus>('connecting');
  const [collectorStatus, setCollectorStatus] = useState<WifiCollectorStatus | null>(
    null
  );
  const [health, setHealth] = useState<WifiCollectorHealth | null>(null);
  const [snapshot, setSnapshot] = useState<WifiDetectorSnapshot | null>(null);
  const [events, setEvents] = useState<WifiEvent[]>([]);
  const [inQuietHours, setInQuietHours] = useState(false);
  const [notificationPermission, setNotificationPermission] =
    useState<WifiNotificationPermission>('default');

  const detectorRef = useRef<MotionDetector | null>(null);
  const pendingEventsRef = useRef<WifiEvent[]>([]);
  const eventIdRef = useRef(0);
  const savedCalibrationRef = useRef<ReturnType<MotionDetector['getCalibration']>>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const lastAlertAtRef = useRef(-Infinity);
  const mockSceneActiveRef = useRef(false);
  // Latest values for callbacks that run outside render (timers, SSE handlers).
  const toastRef = useRef(toast);
  const quietHoursRef = useRef(quietHours);
  const collectorUrlRef = useRef(collectorUrl);
  const sourceRef = useRef<WifiSourceName | null>(null);

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);
  useEffect(() => {
    quietHoursRef.current = quietHours;
  }, [quietHours]);
  useEffect(() => {
    collectorUrlRef.current = collectorUrl;
  }, [collectorUrl]);
  useEffect(() => {
    sourceRef.current = collectorStatus?.source ?? health?.source ?? null;
  }, [collectorStatus, health]);

  // Load saved state and create the detector, in the browser only.
  useEffect(() => {
    const loadedSettings = loadSettings();
    const calibration = loadCalibration();
    savedCalibrationRef.current = calibration;
    detectorRef.current = new MotionDetector({
      settings: loadedSettings,
      calibration,
      onEvent: (event) => pendingEventsRef.current.push(event),
    });
    // localStorage doesn't exist during server rendering, so saved values can only be
    // read after mount; reading them during render would break hydration.
    // oxlint-disable-next-line react/set-state-in-effect
    setSettingsState(loadedSettings);
    setQuietHoursState(loadQuietHours());
    setCollectorUrlState(loadCollectorUrl());
    setNotificationPermission(
      typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
    );
    setReady(true);

    return () => {
      detectorRef.current = null;
      void audioRef.current?.close();
      audioRef.current = null;
    };
  }, []);

  const postMockScene = useCallback((scene: WifiMockScene) => {
    if (sourceRef.current !== 'mock') return;
    const url = `${collectorUrlRef.current}/mock/scene?name=${scene}`;
    fetch(url, { method: 'POST' }).catch(() => {});
  }, []);

  // Snapshot loop: tick the detector, publish its state, flush events, fire alerts.
  useEffect(() => {
    if (!ready) return;

    const alert = (event: WifiEvent): WifiEvent | null => {
      if (!isInQuietHours(new Date(event.t), quietHoursRef.current)) return null;
      if (event.t - lastAlertAtRef.current < ALERT_COOLDOWN_MS) return null;
      lastAlertAtRef.current = event.t;

      const body = `Motion across the Wi-Fi link at ${new Date(event.t).toLocaleTimeString()}`;
      toastRef.current.warning('Motion detected', {
        description: body,
        duration: DURATIONS.TOAST_LONG,
      });
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          new Notification('Afterlife Wi-Fi Sense: motion', { body });
        } catch {
          // Some browsers only allow notifications from a service worker.
        }
      }
      if (!audioRef.current && typeof AudioContext !== 'undefined') {
        audioRef.current = new AudioContext();
      }
      if (audioRef.current) playBeep(audioRef.current);
      return { ...event, type: 'alert', detail: 'quiet hours' };
    };

    const id = setInterval(() => {
      const detector = detectorRef.current;
      if (!detector) return;
      const now = Date.now();
      detector.tick(now);
      const snap = detector.snapshot(now);
      setSnapshot(snap);
      setInQuietHours(isInQuietHours(new Date(now), quietHoursRef.current));

      const calibration = detector.getCalibration();
      if (calibration !== savedCalibrationRef.current) {
        savedCalibrationRef.current = calibration;
        saveCalibration(calibration);
      }
      if (mockSceneActiveRef.current && !snap.calibrating) {
        mockSceneActiveRef.current = false;
        postMockScene('auto');
      }

      const pending = pendingEventsRef.current;
      if (pending.length === 0) return;
      const batch: WifiEvent[] = [];
      for (const raw of pending.splice(0)) {
        batch.push({ ...raw, id: ++eventIdRef.current });
        if (raw.type === 'motion_start') {
          const alertEvent = alert(raw);
          if (alertEvent) batch.push({ ...alertEvent, id: ++eventIdRef.current });
        }
      }
      batch.reverse();
      setEvents((prev) => [...batch, ...prev].slice(0, EVENT_LOG_LIMIT));
    }, SNAPSHOT_INTERVAL_MS);

    return () => clearInterval(id);
  }, [ready, postMockScene]);

  // SSE connection with exponential backoff (1 s, 2 s, 4 s ... 10 s).
  useEffect(() => {
    if (!ready) return;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let delay = RECONNECT_MIN_MS;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const es = new EventSource(`${collectorUrl}/stream`);
      source = es;
      es.onopen = () => {
        delay = RECONNECT_MIN_MS;
        setConnection('open');
      };
      es.addEventListener('sample', (ev) => {
        if (!(ev instanceof MessageEvent) || typeof ev.data !== 'string') return;
        const sample = parseSample(ev.data);
        if (sample) detectorRef.current?.push(sample);
      });
      es.addEventListener('status', (ev) => {
        if (!(ev instanceof MessageEvent) || typeof ev.data !== 'string') return;
        const status = parseStatus(ev.data);
        if (status) setCollectorStatus(status);
      });
      es.onerror = () => {
        // Take over from the browser's built-in retry so we control the backoff.
        es.close();
        if (disposed) return;
        setConnection('error');
        retryTimer = setTimeout(connect, delay);
        delay = Math.min(delay * RECONNECT_FACTOR, RECONNECT_MAX_MS);
      };
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      source?.close();
    };
  }, [ready, collectorUrl]);

  // Poll /health for Diagnostics while connected.
  useEffect(() => {
    if (connection !== 'open') return;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const res = await fetch(`${collectorUrl}/health`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        const parsed = toHealth(await res.json());
        if (parsed) setHealth(parsed);
      } catch {
        // Disconnects are handled by the SSE effect.
      }
    };
    void poll();
    const id = setInterval(poll, HEALTH_POLL_MS);
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [connection, collectorUrl]);

  /** Returns false if the URL isn't a valid http(s) origin. */
  const setCollectorUrl = useCallback((value: string): boolean => {
    const url = normalizeCollectorUrl(value);
    if (!url) return false;
    saveCollectorUrl(url);
    setCollectorUrlState(url);
    setConnection('connecting');
    return true;
  }, []);

  const updateSettings = useCallback(
    (patch: Partial<WifiDetectorSettings>) => {
      const next = { ...settings, ...patch };
      setSettingsState(next);
      saveSettings(next);
      detectorRef.current?.setSettings(next);
    },
    [settings]
  );

  const resetSettings = useCallback(() => {
    setSettingsState(DEFAULT_SETTINGS);
    saveSettings(DEFAULT_SETTINGS);
    detectorRef.current?.setSettings(DEFAULT_SETTINGS);
  }, []);

  const updateQuietHours = useCallback(
    (patch: Partial<WifiQuietHours>) => {
      const next = { ...quietHours, ...patch };
      setQuietHoursState(next);
      saveQuietHours(next);
    },
    [quietHours]
  );

  const refreshSnapshot = useCallback(() => {
    const detector = detectorRef.current;
    if (detector) setSnapshot(detector.snapshot(Date.now()));
  }, []);

  const startCalibration = useCallback(
    (step: WifiCalibrationStep, durationMs: number) => {
      const detector = detectorRef.current;
      if (!detector) return;
      if (detector.startCalibration(step, durationMs, Date.now())) {
        // In mock mode, make the synthetic signal match the instructions.
        if (sourceRef.current === 'mock') {
          mockSceneActiveRef.current = true;
          postMockScene(step === 'empty' ? 'quiet' : 'outside');
        }
      }
      refreshSnapshot();
    },
    [postMockScene, refreshSnapshot]
  );

  const cancelCalibration = useCallback(() => {
    detectorRef.current?.cancelCalibration();
    refreshSnapshot();
  }, [refreshSnapshot]);

  const resetCalibration = useCallback(() => {
    detectorRef.current?.cancelCalibration();
    detectorRef.current?.setCalibration(null);
    refreshSnapshot();
  }, [refreshSnapshot]);

  /** Must run from a click: unlocks audio and asks for notification permission. */
  const enableAlerts = useCallback(async () => {
    if (!audioRef.current && typeof AudioContext !== 'undefined') {
      audioRef.current = new AudioContext();
    }
    void audioRef.current?.resume();
    if (typeof Notification === 'undefined') return;
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  }, []);

  const testAlert = useCallback(() => {
    if (!audioRef.current && typeof AudioContext !== 'undefined') {
      audioRef.current = new AudioContext();
    }
    if (audioRef.current) {
      void audioRef.current.resume();
      playBeep(audioRef.current);
    }
  }, []);

  const clearEvents = useCallback(() => setEvents([]), []);

  return {
    detectorRef,
    collectorUrl,
    setCollectorUrl,
    connection,
    collectorStatus,
    health,
    snapshot,
    events,
    clearEvents,
    settings,
    updateSettings,
    resetSettings,
    quietHours,
    updateQuietHours,
    inQuietHours,
    notificationPermission,
    enableAlerts,
    testAlert,
    startCalibration,
    cancelCalibration,
    resetCalibration,
    setMockScene: postMockScene,
  };
}

export type WifiSenseApi = ReturnType<typeof useWifiSense>;
