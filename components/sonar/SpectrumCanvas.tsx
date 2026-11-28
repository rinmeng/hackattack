'use client';

import { useEffect, useRef } from 'react';

import type { SonarFrame, SonarSubscribe, SonarThemeColors, ToneId } from '@/lib/types';
import {
  PLOT_FAINT_ALPHA,
  PLOT_LABEL_GAP,
  PLOT_LINE_WIDTH,
  PLOT_PAD_BOTTOM,
  PLOT_PAD_LEFT,
  PLOT_PAD_RIGHT,
  PLOT_PAD_TOP,
  PLOT_SHADE_ALPHA,
  PLOT_THIN_LINE_WIDTH,
  PLOT_TITLE_OFFSET,
  REFERENCE_DASH,
  SPECTRUM_GRID_DB,
  SPECTRUM_MAX_DB,
  SPECTRUM_MIN_DB,
  SPECTRUM_SPAN_HZ,
  SPECTRUM_TICK_HZ,
  TONE_R_DASH,
} from '@/lib/sonar/constants';
import { linearToDb } from '@/lib/sonar/dsp';

import {
  attachCanvas,
  type CanvasSurface,
  observeTheme,
  readThemeColors,
} from './canvas';

/** dB of a fraction of the peak amplitude, e.g. 10% → -20 dB. */
function fractionToDb(fraction: number): number {
  return 20 * Math.log10(Math.max(fraction, Number.EPSILON));
}

function drawSpectrum(
  { ctx, width, height }: CanvasSurface,
  colors: SonarThemeColors,
  frame: SonarFrame | null,
  toneId: ToneId,
  fallbackHz: number
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.font = colors.font;
  ctx.setLineDash([]);

  const plotW = width - PLOT_PAD_LEFT - PLOT_PAD_RIGHT;
  const plotH = height - PLOT_PAD_TOP - PLOT_PAD_BOTTOM;
  if (plotW <= 0 || plotH <= 0) return;

  const tone = frame ? frame.tones[toneId] : null;
  const toneHz = tone && tone.toneHz > 0 ? tone.toneHz : fallbackHz;
  const x = (offsetHz: number) =>
    PLOT_PAD_LEFT + ((offsetHz + SPECTRUM_SPAN_HZ) / (2 * SPECTRUM_SPAN_HZ)) * plotW;
  const y = (db: number) => {
    const clamped = Math.min(SPECTRUM_MAX_DB, Math.max(SPECTRUM_MIN_DB, db));
    return (
      PLOT_PAD_TOP +
      ((SPECTRUM_MAX_DB - clamped) / (SPECTRUM_MAX_DB - SPECTRUM_MIN_DB)) * plotH
    );
  };

  // Grid and axes.
  ctx.lineWidth = PLOT_THIN_LINE_WIDTH;
  ctx.strokeStyle = colors.border;
  ctx.fillStyle = colors.muted;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let db = SPECTRUM_MIN_DB; db <= SPECTRUM_MAX_DB; db += SPECTRUM_GRID_DB) {
    ctx.beginPath();
    ctx.moveTo(PLOT_PAD_LEFT, y(db));
    ctx.lineTo(PLOT_PAD_LEFT + plotW, y(db));
    ctx.stroke();
    ctx.fillText(`${db}`, PLOT_PAD_LEFT - PLOT_LABEL_GAP, y(db));
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let off = -SPECTRUM_SPAN_HZ; off <= SPECTRUM_SPAN_HZ; off += SPECTRUM_TICK_HZ) {
    ctx.beginPath();
    ctx.moveTo(x(off), PLOT_PAD_TOP);
    ctx.lineTo(x(off), PLOT_PAD_TOP + plotH);
    ctx.stroke();
    ctx.fillText(
      `${Math.round(toneHz + off)}`,
      x(off),
      PLOT_PAD_TOP + plotH + PLOT_LABEL_GAP
    );
  }
  ctx.textAlign = 'left';
  ctx.fillText('dB', PLOT_TITLE_OFFSET, PLOT_TITLE_OFFSET);
  ctx.textAlign = 'right';
  ctx.fillText('Hz', width - PLOT_PAD_RIGHT, PLOT_TITLE_OFFSET);

  ctx.textAlign = 'left';
  ctx.fillStyle = colors.foreground;
  ctx.fillText(
    `Tone ${toneId} · ${Math.round(toneHz)} Hz`,
    PLOT_PAD_LEFT,
    PLOT_TITLE_OFFSET
  );

  const spectrum = frame?.spectrumDb;
  if (!frame || !tone || !spectrum || frame.binWidth <= 0) {
    ctx.fillStyle = colors.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Press Start to see the tone', PLOT_PAD_LEFT + plotW / 2, height / 2);
    return;
  }

  const bw = frame.binWidth;
  const spanBins = Math.ceil(SPECTRUM_SPAN_HZ / bw);
  const lo = Math.max(0, tone.toneBin - spanBins);
  const hi = Math.min(spectrum.length - 1, tone.toneBin + spanBins);
  const binX = (bin: number) => x(bin * bw - toneHz);

  ctx.save();
  ctx.beginPath();
  ctx.rect(PLOT_PAD_LEFT, PLOT_PAD_TOP, plotW, plotH);
  ctx.clip();

  // Scanned bandwidth.
  ctx.globalAlpha = PLOT_SHADE_ALPHA;
  ctx.fillStyle = colors.primary;
  const bandLo = binX(tone.peakBin - tone.leftBins - 0.5);
  const bandHi = binX(tone.peakBin + tone.rightBins + 0.5);
  ctx.fillRect(bandLo, PLOT_PAD_TOP, bandHi - bandLo, plotH);
  ctx.globalAlpha = 1;

  // Baseline mean, faint.
  const baseline = frame.baselineSpectrum;
  if (baseline && baseline.length === spectrum.length) {
    ctx.globalAlpha = PLOT_FAINT_ALPHA;
    ctx.strokeStyle = colors.muted;
    ctx.lineWidth = PLOT_THIN_LINE_WIDTH;
    ctx.beginPath();
    for (let k = lo; k <= hi; k++) {
      const py = y(linearToDb(baseline[k]));
      if (k === lo) ctx.moveTo(binX(k), py);
      else ctx.lineTo(binX(k), py);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Bandwidth threshold (a fraction of the peak).
  const thresholdDb = tone.peakDb + fractionToDb(frame.thresholdFrac);
  ctx.setLineDash(REFERENCE_DASH);
  ctx.strokeStyle = colors.destructive;
  ctx.lineWidth = PLOT_THIN_LINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(PLOT_PAD_LEFT, y(thresholdDb));
  ctx.lineTo(PLOT_PAD_LEFT + plotW, y(thresholdDb));
  ctx.stroke();

  // Nominal tone frequency.
  ctx.strokeStyle = colors.muted;
  ctx.beginPath();
  ctx.moveTo(x(0), PLOT_PAD_TOP);
  ctx.lineTo(x(0), PLOT_PAD_TOP + plotH);
  ctx.stroke();

  // Live spectrum.
  ctx.setLineDash(toneId === 'R' ? TONE_R_DASH : []);
  ctx.strokeStyle = toneId === 'L' ? colors.toneL : colors.toneR;
  ctx.lineWidth = PLOT_LINE_WIDTH;
  ctx.beginPath();
  for (let k = lo; k <= hi; k++) {
    const py = y(spectrum[k]);
    if (k === lo) ctx.moveTo(binX(k), py);
    else ctx.lineTo(binX(k), py);
  }
  ctx.stroke();
  ctx.restore();

  ctx.setLineDash([]);
  ctx.fillStyle = tone.moving ? colors.destructive : colors.muted;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(
    `${tone.peakDb.toFixed(0)} dB  ←${tone.leftBins} ${tone.rightBins}→`,
    PLOT_PAD_LEFT + plotW,
    PLOT_PAD_TOP + PLOT_LABEL_GAP
  );
}

interface SpectrumCanvasProps {
  tone: ToneId;
  /** Shown on the axis before the sonar starts. */
  fallbackHz: number;
  on: SonarSubscribe;
}

/** ±500 Hz around one tone, drawn straight to canvas on every 'motion' frame. */
export function SpectrumCanvas({ tone, fallbackHz, on }: SpectrumCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let surface: CanvasSurface | null = null;
    let colors = readThemeColors();
    let frame: SonarFrame | null = null;

    const draw = () => {
      if (surface) drawSpectrum(surface, colors, frame, tone, fallbackHz);
    };
    const detach = attachCanvas(canvas, (next) => {
      surface = next;
      draw();
    });
    const stopTheme = observeTheme(() => {
      colors = readThemeColors();
      draw();
    });
    const offMotion = on('motion', (next) => {
      frame = next;
      draw();
    });
    const offStatus = on('status', (status) => {
      if (status === 'idle') {
        frame = null;
        draw();
      }
    });

    return () => {
      detach();
      stopTheme();
      offMotion();
      offStatus();
    };
  }, [on, tone, fallbackHz]);

  return (
    <canvas
      ref={canvasRef}
      role='img'
      aria-label={`Spectrum around tone ${tone}`}
      className='h-56 w-full'
    />
  );
}
