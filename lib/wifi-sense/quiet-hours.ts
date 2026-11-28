import type { WifiQuietHours } from '@/lib/types';
import { MINUTES_PER_HOUR } from './constants';

/** "HH:MM" to minutes after midnight, or null if malformed. */
export function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m >= MINUTES_PER_HOUR) return null;
  return h * MINUTES_PER_HOUR + m;
}

/**
 * Whether `date` (local time) falls in the quiet hours. Handles ranges that cross
 * midnight (e.g. 23:00 to 06:00). Start is inclusive, end exclusive; equal start and
 * end means all day.
 */
export function isInQuietHours(date: Date, quiet: WifiQuietHours): boolean {
  if (!quiet.enabled) return false;
  const start = parseClock(quiet.start);
  const end = parseClock(quiet.end);
  if (start === null || end === null) return false;
  const now = date.getHours() * MINUTES_PER_HOUR + date.getMinutes();
  if (start === end) return true;
  return start < end ? now >= start && now < end : now >= start || now < end;
}
