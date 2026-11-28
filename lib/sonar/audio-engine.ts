/**
 * Web Audio plumbing: two stereo sine tones out, the raw mic in, one AnalyserNode.
 *
 *   oscL ─► merger in 0 ─┐
 *   oscR ─► merger in 1 ─┴─► master gain ─► destination
 *   mic  ─► analyser                         (never connected to the destination)
 *
 * Browser APIs are touched only inside methods, never at import time, so this module
 * is safe to import from server-rendered code.
 */
import type { FftSize, SonarErrorCode } from '@/lib/types';

import {
  ANALYSER_MAX_DB,
  ANALYSER_MIN_DB,
  ANALYSER_SMOOTHING,
  FREQUENCY_GLIDE_S,
  GAIN_RAMP_S,
  MIN_SAMPLE_RATE,
  NYQUIST_MARGIN_HZ,
  REQUESTED_SAMPLE_RATE,
  STOP_GRACE_MS,
} from './constants';
import { dbArrayToLinear } from './dsp';

export class SonarError extends Error {
  readonly code: SonarErrorCode;

  constructor(code: SonarErrorCode, message: string) {
    super(message);
    this.name = 'SonarError';
    this.code = code;
  }
}

export interface EngineStartOptions {
  toneLHz: number;
  toneRHz: number;
  masterGain: number;
  fftSize: FftSize;
}

/** How a tone change is applied: a phase-continuous glide, or a 50 ms gain dip. */
export type ToneChangeMode = 'glide' | 'dip';

interface AudioGraph {
  ctx: AudioContext;
  oscL: OscillatorNode;
  oscR: OscillatorNode;
  merger: ChannelMergerNode;
  master: GainNode;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  stream: MediaStream;
}

function mapMediaError(error: unknown): SonarError {
  if (error instanceof SonarError) return error;
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return new SonarError('permission-denied', error.message);
      case 'NotFoundError':
      case 'OverconstrainedError':
        return new SonarError('no-microphone', error.message);
      case 'NotReadableError':
      case 'AbortError':
        return new SonarError('mic-busy', error.message);
    }
  }
  return new SonarError(
    'unknown',
    error instanceof Error ? error.message : 'Unknown audio error'
  );
}

export class SonarAudioEngine {
  private graph: AudioGraph | null = null;
  private stopped = false;

  /** Latest analyser output in dB, and the same spectrum as linear magnitude. */
  decibels: Float32Array<ArrayBuffer> = new Float32Array(0);
  magnitudes: Float32Array<ArrayBuffer> = new Float32Array(0);

  sampleRate = 0;
  fftSize: FftSize = 4096;
  toneLHz = 0;
  toneRHz = 0;
  masterGain = 0;
  muted = false;
  /** The mic track's getSettings(), stringified for the debug panel. */
  trackSettings: Record<string, string> = {};

  get running(): boolean {
    return this.graph !== null && !this.stopped;
  }

  /** Highest tone frequency this context can play cleanly. */
  get maxToneHz(): number {
    return this.sampleRate / 2 - NYQUIST_MARGIN_HZ;
  }

  /**
   * Build the graph and start the tones. Call from a click handler: the AudioContext
   * is created synchronously, before the first await, so it starts under the user
   * gesture (autoplay policy).
   */
  async start(options: EngineStartOptions): Promise<void> {
    if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') {
      throw new SonarError('no-web-audio', 'Web Audio API is not available');
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new SonarError('insecure-context', 'getUserMedia is not available');
    }

    const ctx = new AudioContext({ sampleRate: REQUESTED_SAMPLE_RATE });
    let stream: MediaStream | null = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
      if (this.stopped) throw new SonarError('unknown', 'Stopped during start');

      this.sampleRate = ctx.sampleRate;
      if (ctx.sampleRate < MIN_SAMPLE_RATE) {
        throw new SonarError(
          'low-sample-rate',
          `Sample rate is ${ctx.sampleRate} Hz, below ${MIN_SAMPLE_RATE} Hz`
        );
      }
      await ctx.resume();

      const master = new GainNode(ctx, { gain: 0 });
      const merger = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
      const oscL = new OscillatorNode(ctx, {
        type: 'sine',
        frequency: this.clampTone(options.toneLHz),
      });
      const oscR = new OscillatorNode(ctx, {
        type: 'sine',
        frequency: this.clampTone(options.toneRHz),
      });
      oscL.connect(merger, 0, 0);
      oscR.connect(merger, 0, 1);
      merger.connect(master);
      master.connect(ctx.destination);

      const source = new MediaStreamAudioSourceNode(ctx, { mediaStream: stream });
      const analyser = new AnalyserNode(ctx, {
        fftSize: options.fftSize,
        smoothingTimeConstant: ANALYSER_SMOOTHING,
        minDecibels: ANALYSER_MIN_DB,
        maxDecibels: ANALYSER_MAX_DB,
      });
      // The mic goes to the analyser only. Never to ctx.destination (feedback).
      source.connect(analyser);

      this.graph = { ctx, oscL, oscR, merger, master, source, analyser, stream };
      this.fftSize = options.fftSize;
      this.allocateBuffers();
      this.toneLHz = oscL.frequency.value;
      this.toneRHz = oscR.frequency.value;
      this.masterGain = options.masterGain;
      this.trackSettings = this.readTrackSettings(stream);

      oscL.start();
      oscR.start();
      this.rampGain(options.masterGain);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      this.graph = null;
      void ctx.close().catch(() => undefined);
      throw mapMediaError(error);
    }
  }

  /** Read the analyser into `decibels` and convert into `magnitudes`. */
  readSpectrum(): void {
    const graph = this.graph;
    if (!graph) return;
    graph.analyser.getFloatFrequencyData(this.decibels);
    dbArrayToLinear(this.decibels, this.magnitudes);
  }

  setMasterGain(gain: number): void {
    if (gain === this.masterGain) return;
    this.masterGain = gain;
    if (!this.muted) this.rampGain(gain);
  }

  /** Change the tones. Returns false when nothing changed (after Nyquist clamping). */
  setTones(toneLHz: number, toneRHz: number, mode: ToneChangeMode): boolean {
    const graph = this.graph;
    if (!graph) return false;
    const l = this.clampTone(toneLHz);
    const r = this.clampTone(toneRHz);
    if (l === this.toneLHz && r === this.toneRHz) return false;
    this.toneLHz = l;
    this.toneRHz = r;

    const now = graph.ctx.currentTime;
    if (mode === 'glide' || this.muted) {
      this.glide(graph.oscL.frequency, l, now);
      this.glide(graph.oscR.frequency, r, now);
      return true;
    }

    // Dip: ramp down, change frequency at silence, ramp back up.
    const gain = graph.master.gain;
    this.holdParam(gain, now);
    gain.linearRampToValueAtTime(0, now + GAIN_RAMP_S);
    this.holdParam(graph.oscL.frequency, now);
    graph.oscL.frequency.setValueAtTime(l, now + GAIN_RAMP_S);
    this.holdParam(graph.oscR.frequency, now);
    graph.oscR.frequency.setValueAtTime(r, now + GAIN_RAMP_S);
    gain.linearRampToValueAtTime(this.masterGain, now + 2 * GAIN_RAMP_S);
    return true;
  }

  setFftSize(fftSize: FftSize): void {
    const graph = this.graph;
    if (!graph || fftSize === this.fftSize) return;
    graph.analyser.fftSize = fftSize;
    this.fftSize = fftSize;
    this.allocateBuffers();
  }

  /** Silence the tones (tab hidden) without tearing anything down. */
  setMuted(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    this.rampGain(muted ? 0 : this.masterGain);
  }

  /**
   * Fade out over 50 ms, then stop the oscillators and close the context. The mic
   * tracks stop immediately, so the browser's mic indicator turns off.
   */
  stop(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.stopped = true;
    const graph = this.graph;
    this.graph = null;
    if (!graph) return Promise.resolve();

    graph.stream.getTracks().forEach((track) => track.stop());
    graph.source.disconnect();

    const now = graph.ctx.currentTime;
    const gain = graph.master.gain;
    this.holdParam(gain, now);
    gain.linearRampToValueAtTime(0, now + GAIN_RAMP_S);
    graph.oscL.stop(now + GAIN_RAMP_S);
    graph.oscR.stop(now + GAIN_RAMP_S);

    return new Promise((resolve) => {
      window.setTimeout(
        () => {
          graph.oscL.disconnect();
          graph.oscR.disconnect();
          graph.merger.disconnect();
          graph.master.disconnect();
          graph.ctx
            .close()
            .catch(() => undefined)
            .finally(resolve);
        },
        GAIN_RAMP_S * 1000 + STOP_GRACE_MS
      );
    });
  }

  private allocateBuffers(): void {
    const bins = this.fftSize / 2;
    this.decibels = new Float32Array(bins);
    this.magnitudes = new Float32Array(bins);
  }

  private clampTone(hz: number): number {
    const max = this.sampleRate > 0 ? this.maxToneHz : hz;
    return Math.max(0, Math.min(hz, max));
  }

  /** Freeze a param at its current value so new ramps start from there. */
  private holdParam(param: AudioParam, now: number): void {
    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(now);
    } else {
      const value = param.value;
      param.cancelScheduledValues(now);
      param.setValueAtTime(value, now);
    }
  }

  private glide(param: AudioParam, hz: number, now: number): void {
    this.holdParam(param, now);
    param.linearRampToValueAtTime(hz, now + FREQUENCY_GLIDE_S);
  }

  private rampGain(target: number): void {
    const graph = this.graph;
    if (!graph) return;
    const now = graph.ctx.currentTime;
    const gain = graph.master.gain;
    this.holdParam(gain, now);
    gain.linearRampToValueAtTime(target, now + GAIN_RAMP_S);
  }

  private readTrackSettings(stream: MediaStream): Record<string, string> {
    const track = stream.getAudioTracks()[0];
    if (!track) return {};
    const s = track.getSettings();
    const entries: Record<string, string> = { label: track.label || 'unknown' };
    const add = (key: string, value: string | number | boolean | undefined) => {
      if (value !== undefined) entries[key] = String(value);
    };
    add('sampleRate', s.sampleRate);
    add('channelCount', s.channelCount);
    add('sampleSize', s.sampleSize);
    add('echoCancellation', s.echoCancellation);
    add('noiseSuppression', s.noiseSuppression);
    add('autoGainControl', s.autoGainControl);
    add('deviceId', s.deviceId);
    return entries;
  }
}
