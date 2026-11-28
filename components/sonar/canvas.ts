/**
 * Canvas helpers shared by the spectrum and velocity panels. Call only from effects:
 * they touch window, document and ResizeObserver.
 */
import type { SonarThemeColors } from '@/lib/types';

import { PLOT_FONT_PX } from '@/lib/sonar/constants';

export interface CanvasSurface {
  ctx: CanvasRenderingContext2D;
  /** Size in CSS pixels. The context is scaled, so draw in CSS pixels. */
  width: number;
  height: number;
}

/**
 * Keep a canvas's backing store matched to its CSS size × devicePixelRatio.
 * Calls `onResize` with a ready-to-draw surface. Returns a cleanup function.
 */
export function attachCanvas(
  canvas: HTMLCanvasElement,
  onResize: (surface: CanvasSurface) => void
): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => undefined;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    onResize({ ctx, width, height });
  };

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  return () => observer.disconnect();
}

function cssVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim();
  return value || fallback;
}

/** Read the theme's colours from its CSS variables (they change with light/dark). */
export function readThemeColors(): SonarThemeColors {
  const styles = getComputedStyle(document.documentElement);
  const mono = cssVar(styles, '--font-geist-mono', 'ui-monospace');
  return {
    foreground: cssVar(styles, '--foreground', '#111'),
    muted: cssVar(styles, '--muted-foreground', '#888'),
    border: cssVar(styles, '--border', '#ddd'),
    primary: cssVar(styles, '--primary', '#111'),
    // The theme is monochrome, so the two tones differ by weight and dash, not hue.
    toneL: cssVar(styles, '--foreground', '#111'),
    toneR: cssVar(styles, '--muted-foreground', '#888'),
    destructive: cssVar(styles, '--destructive', '#dc2626'),
    font: `${PLOT_FONT_PX}px ${mono}, ui-monospace, monospace`,
  };
}

/** Call `onChange` when the theme class or inline style on <html> changes. */
export function observeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-theme'],
  });
  return () => observer.disconnect();
}
