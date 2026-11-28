import type { WifiEvent } from '@/lib/types';

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Events as CSV, oldest first, with ISO timestamps. */
export function eventsToCsv(events: readonly WifiEvent[]): string {
  const rows = ['time,type,score,threshold,detail'];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    rows.push(
      [new Date(e.t).toISOString(), e.type, e.score, e.threshold, e.detail]
        .map(cell)
        .join(',')
    );
  }
  return rows.join('\n') + '\n';
}
