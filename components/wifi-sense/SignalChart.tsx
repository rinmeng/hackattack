'use client';

import { type RefObject, useEffect, useRef } from 'react';
import {
  CH_MOTION,
  CH_RSSI,
  CH_SCORE,
  CH_T,
  CH_THRESHOLD,
  CHART_DASH,
  CHART_FONT_PX,
  CHART_GAP_MS,
  CHART_HEIGHT_PX,
  CHART_LINE_WIDTH_PX,
  CHART_MIN_RSSI_SPAN_DB,
  CHART_MIN_SCORE_SPAN_DB,
  CHART_MOTION_ALPHA,
  CHART_PADDING_PX,
  CHART_RSSI_SHARE,
  CHART_WINDOW_MS,
  MS_PER_SECOND,
} from '@/lib/wifi-sense/constants';
import type { MotionDetector } from '@/lib/wifi-sense/detector';
import type { RingBuffer } from '@/lib/wifi-sense/ring-buffer';

interface Palette {
  fg: string;
  muted: string;
  grid: string;
  rssi: string;
  score: string;
  threshold: string;
  motion: string;
}

/** Colours from the theme's CSS variables, so the chart follows light and dark mode. */
function readPalette(el: HTMLElement): Palette {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) =>
    css.getPropertyValue(name).trim() || fallback;
  return {
    fg: v('--foreground', '#111'),
    muted: v('--muted-foreground', '#666'),
    grid: v('--border', '#ddd'),
    rssi: v('--primary', '#333'),
    score: v('--chart-2', '#888'),
    threshold: v('--destructive', '#d33'),
    motion: v('--destructive', '#d33'),
  };
}

interface SignalChartProps {
  detectorRef: RefObject<MotionDetector | null>;
}

/**
 * Last 60 s of RSSI (top), the spread score with threshold T (bottom), and shaded
 * MOTION periods. Drawn on a canvas every animation frame straight from the
 * detector's ring buffer, so samples never go through React state.
 */
export function SignalChart({ detectorRef }: SignalChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let width = 0;
    let height = 0;
    let palette = readPalette(canvas);
    let paletteAt = 0;
    let frame = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const draw = (time: number) => {
      frame = requestAnimationFrame(draw);
      // Re-read colours about once a second, which picks up theme switches.
      if (time - paletteAt > MS_PER_SECOND) {
        palette = readPalette(canvas);
        paletteAt = time;
      }
      ctx.clearRect(0, 0, width, height);
      const detector = detectorRef.current;
      if (detector) drawRing(ctx, detector.ring, width, height, palette);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [detectorRef]);

  return (
    <canvas
      ref={canvasRef}
      className='w-full'
      style={{ height: CHART_HEIGHT_PX }}
      role='img'
      aria-label='RSSI and motion score over the last 60 seconds'
    />
  );
}

function drawRing(
  ctx: CanvasRenderingContext2D,
  ring: RingBuffer,
  width: number,
  height: number,
  p: Palette
) {
  const end = ring.endSeq;
  ctx.font = `${CHART_FONT_PX}px ui-sans-serif, system-ui, sans-serif`;
  if (end === 0) {
    ctx.fillStyle = p.muted;
    ctx.fillText('Waiting for samples...', CHART_PADDING_PX, height / 2);
    return;
  }

  const tEnd = Math.max(ring.get(CH_T, end - 1), Date.now());
  const tStart = tEnd - CHART_WINDOW_MS;

  // One pass to find the visible range and the axis limits.
  let start = end;
  let rMin = Infinity;
  let rMax = -Infinity;
  let sMax = 0;
  while (start > ring.firstSeq && ring.get(CH_T, start - 1) >= tStart) {
    start--;
    const r = ring.get(CH_RSSI, start);
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
    const s = ring.get(CH_SCORE, start);
    if (s > sMax) sMax = s;
    const th = ring.get(CH_THRESHOLD, start);
    if (th > sMax) sMax = th;
  }
  if (start === end) return;
  if (rMax - rMin < CHART_MIN_RSSI_SPAN_DB) {
    const mid = (rMax + rMin) / 2;
    rMin = mid - CHART_MIN_RSSI_SPAN_DB / 2;
    rMax = mid + CHART_MIN_RSSI_SPAN_DB / 2;
  }
  sMax = Math.max(sMax, CHART_MIN_SCORE_SPAN_DB);

  const pad = CHART_PADDING_PX;
  const split = height * CHART_RSSI_SHARE;
  const x = (t: number) => ((t - tStart) / CHART_WINDOW_MS) * width;
  const yRssi = (r: number) => pad + (1 - (r - rMin) / (rMax - rMin)) * (split - 2 * pad);
  const yScore = (s: number) => split + pad + (1 - s / sMax) * (height - split - 2 * pad);

  // MOTION shading over both panels.
  ctx.globalAlpha = CHART_MOTION_ALPHA;
  ctx.fillStyle = p.motion;
  let spanStart = NaN;
  for (let seq = start; seq < end; seq++) {
    const on = ring.get(CH_MOTION, seq) === 1;
    const t = ring.get(CH_T, seq);
    if (on && Number.isNaN(spanStart)) spanStart = t;
    if ((!on || seq === end - 1) && !Number.isNaN(spanStart)) {
      ctx.fillRect(x(spanStart), 0, Math.max(1, x(t) - x(spanStart)), height);
      spanStart = NaN;
    }
  }
  ctx.globalAlpha = 1;

  // Panel divider.
  ctx.strokeStyle = p.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, split);
  ctx.lineTo(width, split);
  ctx.stroke();

  ctx.lineWidth = CHART_LINE_WIDTH_PX;
  strokeSeries(ctx, ring, start, end, CH_RSSI, x, yRssi, p.rssi);
  strokeSeries(ctx, ring, start, end, CH_SCORE, x, yScore, p.score);
  ctx.setLineDash(CHART_DASH);
  strokeSeries(ctx, ring, start, end, CH_THRESHOLD, x, yScore, p.threshold);
  ctx.setLineDash([]);

  // Labels.
  ctx.fillStyle = p.muted;
  ctx.fillText(`RSSI  ${Math.round(rMax)} dBm`, pad, pad + CHART_FONT_PX);
  ctx.fillText(`${Math.round(rMin)} dBm`, pad, split - pad);
  ctx.fillText(
    `score (spread, dB)  max ${sMax.toFixed(1)}`,
    pad,
    split + pad + CHART_FONT_PX
  );
  ctx.fillText(`-${CHART_WINDOW_MS / MS_PER_SECOND} s`, pad, height - pad);
  ctx.textAlign = 'right';
  ctx.fillText('now', width - pad, height - pad);
  ctx.fillStyle = p.threshold;
  ctx.fillText('- - threshold T', width - pad, split + pad + CHART_FONT_PX);
  ctx.textAlign = 'left';
}

function strokeSeries(
  ctx: CanvasRenderingContext2D,
  ring: RingBuffer,
  start: number,
  end: number,
  channel: number,
  x: (t: number) => number,
  y: (v: number) => number,
  color: string
) {
  ctx.strokeStyle = color;
  ctx.beginPath();
  let penDown = false;
  let prevT = NaN;
  for (let seq = start; seq < end; seq++) {
    const v = ring.get(channel, seq);
    const t = ring.get(CH_T, seq);
    if (!Number.isFinite(v) || t - prevT > CHART_GAP_MS) penDown = false;
    prevT = t;
    if (!Number.isFinite(v)) continue;
    if (penDown) ctx.lineTo(x(t), y(v));
    else {
      ctx.moveTo(x(t), y(v));
      penDown = true;
    }
  }
  ctx.stroke();
}
