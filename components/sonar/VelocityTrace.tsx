'use client';

import { useEffect, useRef } from 'react';

import type { GestureDirection, SonarSubscribe, SonarThemeColors } from '@/lib/types';
import {
  PLOT_FAINT_ALPHA,
  PLOT_LABEL_GAP,
  PLOT_LEGEND_WIDTH,
  PLOT_LINE_WIDTH,
  PLOT_PAD_BOTTOM,
  PLOT_PAD_LEFT,
  PLOT_PAD_RIGHT,
  PLOT_PAD_TOP,
  PLOT_THIN_LINE_WIDTH,
  PLOT_TITLE_OFFSET,
  TONE_IDS,
  TONE_R_DASH,
  TRACE_CAPACITY,
  TRACE_GRID_MPS,
  TRACE_MARKER_CAPACITY,
  TRACE_MOVING_STRIP_PX,
  TRACE_RANGE_MPS,
  TRACE_WINDOW_MS,
} from '@/lib/sonar/constants';

import {
  attachCanvas,
  type CanvasSurface,
  observeTheme,
  readThemeColors,
} from './canvas';

/** Fixed-size ring buffers for the last few seconds of per-tone velocity. */
interface TraceBuffers {
  time: Float64Array;
  vL: Float32Array;
  vR: Float32Array;
  movingL: Uint8Array;
  movingR: Uint8Array;
  head: number;
  count: number;
  markerTime: Float64Array;
  markerDir: Uint8Array;
  markerHead: number;
  markerCount: number;
  latest: number;
}

function createBuffers(): TraceBuffers {
  return {
    time: new Float64Array(TRACE_CAPACITY),
    vL: new Float32Array(TRACE_CAPACITY),
    vR: new Float32Array(TRACE_CAPACITY),
    movingL: new Uint8Array(TRACE_CAPACITY),
    movingR: new Uint8Array(TRACE_CAPACITY),
    head: 0,
    count: 0,
    markerTime: new Float64Array(TRACE_MARKER_CAPACITY),
    markerDir: new Uint8Array(TRACE_MARKER_CAPACITY),
    markerHead: 0,
    markerCount: 0,
    latest: 0,
  };
}

function drawTrace(
  { ctx, width, height }: CanvasSurface,
  colors: SonarThemeColors,
  b: TraceBuffers
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.font = colors.font;
  ctx.setLineDash([]);

  const plotW = width - PLOT_PAD_LEFT - PLOT_PAD_RIGHT;
  const plotH = height - PLOT_PAD_TOP - PLOT_PAD_BOTTOM;
  if (plotW <= 0 || plotH <= 0) return;

  const now = b.latest;
  const x = (t: number) => PLOT_PAD_LEFT + (1 - (now - t) / TRACE_WINDOW_MS) * plotW;
  const y = (v: number) => {
    const clamped = Math.max(-TRACE_RANGE_MPS, Math.min(TRACE_RANGE_MPS, v));
    return PLOT_PAD_TOP + ((TRACE_RANGE_MPS - clamped) / (2 * TRACE_RANGE_MPS)) * plotH;
  };

  // Grid.
  ctx.lineWidth = PLOT_THIN_LINE_WIDTH;
  ctx.strokeStyle = colors.border;
  ctx.fillStyle = colors.muted;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const gridLines = Math.round((2 * TRACE_RANGE_MPS) / TRACE_GRID_MPS);
  for (let i = 0; i <= gridLines; i++) {
    const v = -TRACE_RANGE_MPS + i * TRACE_GRID_MPS;
    ctx.beginPath();
    ctx.moveTo(PLOT_PAD_LEFT, y(v));
    ctx.lineTo(PLOT_PAD_LEFT + plotW, y(v));
    ctx.stroke();
    ctx.fillText(v.toFixed(1), PLOT_PAD_LEFT - PLOT_LABEL_GAP, y(v));
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const seconds = TRACE_WINDOW_MS / 1000;
  for (let s = 0; s <= seconds; s++) {
    const px = PLOT_PAD_LEFT + (1 - s / seconds) * plotW;
    ctx.fillText(s === 0 ? 'now' : `-${s}s`, px, PLOT_PAD_TOP + plotH + PLOT_LABEL_GAP);
  }
  ctx.textAlign = 'left';
  ctx.fillText('m/s (+ toward)', PLOT_TITLE_OFFSET, PLOT_TITLE_OFFSET);

  // Legend.
  ctx.textAlign = 'right';
  ctx.fillStyle = colors.toneL;
  ctx.fillText('— tone L', width - PLOT_PAD_RIGHT - PLOT_LEGEND_WIDTH, PLOT_TITLE_OFFSET);
  ctx.fillStyle = colors.toneR;
  ctx.fillText('- - tone R', width - PLOT_PAD_RIGHT, PLOT_TITLE_OFFSET);

  if (b.count === 0) {
    ctx.fillStyle = colors.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      'Velocity appears here once listening',
      PLOT_PAD_LEFT + plotW / 2,
      height / 2
    );
    return;
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(PLOT_PAD_LEFT, PLOT_PAD_TOP, plotW, plotH);
  ctx.clip();

  // Trigger markers.
  ctx.lineWidth = PLOT_THIN_LINE_WIDTH;
  ctx.strokeStyle = colors.destructive;
  ctx.fillStyle = colors.destructive;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (let i = 0; i < b.markerCount; i++) {
    const idx = (b.markerHead - 1 - i + TRACE_MARKER_CAPACITY) % TRACE_MARKER_CAPACITY;
    const t = b.markerTime[idx];
    if (now - t > TRACE_WINDOW_MS) continue;
    const px = x(t);
    ctx.beginPath();
    ctx.moveTo(px, PLOT_PAD_TOP);
    ctx.lineTo(px, PLOT_PAD_TOP + plotH);
    ctx.stroke();
    ctx.fillText(
      b.markerDir[idx] === 0 ? 'LEFT' : 'RIGHT',
      px + PLOT_LABEL_GAP,
      PLOT_PAD_TOP + TRACE_MOVING_STRIP_PX * 2 + PLOT_LABEL_GAP
    );
  }

  // Per-tone "moving" strips along the top, so L-then-R order is easy to read.
  const start = (b.head - b.count + TRACE_CAPACITY) % TRACE_CAPACITY;
  ctx.globalAlpha = PLOT_FAINT_ALPHA * 2;
  for (let i = 1; i < b.count; i++) {
    const prev = (start + i - 1) % TRACE_CAPACITY;
    const idx = (start + i) % TRACE_CAPACITY;
    if (now - b.time[idx] > TRACE_WINDOW_MS) continue;
    const x0 = x(b.time[prev]);
    const w = Math.max(1, x(b.time[idx]) - x0);
    if (b.movingL[idx]) {
      ctx.fillStyle = colors.toneL;
      ctx.fillRect(x0, PLOT_PAD_TOP, w, TRACE_MOVING_STRIP_PX);
    }
    if (b.movingR[idx]) {
      ctx.fillStyle = colors.toneR;
      ctx.fillRect(x0, PLOT_PAD_TOP + TRACE_MOVING_STRIP_PX, w, TRACE_MOVING_STRIP_PX);
    }
  }
  ctx.globalAlpha = 1;

  // Velocity lines.
  ctx.lineWidth = PLOT_LINE_WIDTH;
  for (const tone of TONE_IDS) {
    const values = tone === 'L' ? b.vL : b.vR;
    ctx.setLineDash(tone === 'L' ? [] : TONE_R_DASH);
    ctx.strokeStyle = tone === 'L' ? colors.toneL : colors.toneR;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < b.count; i++) {
      const idx = (start + i) % TRACE_CAPACITY;
      if (now - b.time[idx] > TRACE_WINDOW_MS) continue;
      const px = x(b.time[idx]);
      const py = y(values[idx]);
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
  }
  ctx.restore();
  ctx.setLineDash([]);
}

interface VelocityTraceProps {
  on: SonarSubscribe;
}

/** Scrolling 5 s velocity trace, one line per tone, with trigger markers. */
export function VelocityTrace({ on }: VelocityTraceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const buffers = createBuffers();
    let surface: CanvasSurface | null = null;
    let colors = readThemeColors();

    const draw = () => {
      if (surface) drawTrace(surface, colors, buffers);
    };
    const addMarker = (direction: GestureDirection, time: number) => {
      buffers.markerTime[buffers.markerHead] = time;
      buffers.markerDir[buffers.markerHead] = direction === 'left' ? 0 : 1;
      buffers.markerHead = (buffers.markerHead + 1) % TRACE_MARKER_CAPACITY;
      buffers.markerCount = Math.min(buffers.markerCount + 1, TRACE_MARKER_CAPACITY);
      draw();
    };

    const detach = attachCanvas(canvas, (next) => {
      surface = next;
      draw();
    });
    const stopTheme = observeTheme(() => {
      colors = readThemeColors();
      draw();
    });
    const offs = [
      on('motion', (frame) => {
        const i = buffers.head;
        buffers.time[i] = frame.time;
        buffers.vL[i] = frame.tones.L.velocity;
        buffers.vR[i] = frame.tones.R.velocity;
        buffers.movingL[i] = frame.tones.L.moving ? 1 : 0;
        buffers.movingR[i] = frame.tones.R.moving ? 1 : 0;
        buffers.head = (i + 1) % TRACE_CAPACITY;
        buffers.count = Math.min(buffers.count + 1, TRACE_CAPACITY);
        buffers.latest = frame.time;
        draw();
      }),
      on('left', (event) => addMarker('left', event.time)),
      on('right', (event) => addMarker('right', event.time)),
      on('status', (status) => {
        if (status === 'idle') {
          buffers.count = 0;
          buffers.markerCount = 0;
          draw();
        }
      }),
    ];

    return () => {
      detach();
      stopTheme();
      offs.forEach((off) => off());
    };
  }, [on]);

  return (
    <canvas
      ref={canvasRef}
      role='img'
      aria-label='Velocity trace for both tones over the last 5 seconds'
      className='h-48 w-full'
    />
  );
}
