// Pure formatting + shared constants. No React/DOM imports.

/** Ship color palette (PRD §"Colors per ship"), cycled in friendly-ship order. */
export const SHIP_PALETTE = [
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#06B6D4',
  '#84CC16',
];

export const pad2 = (n: number): string => String(n).padStart(2, '0');
export const pad3 = (n: number): string => String(n).padStart(3, '0');

/** Parse "HH:MM:SS" into seconds since midnight, or null if malformed. */
export function parseHHMMSS(value: string): number | null {
  const m = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  if (h > 23) return null;
  return h * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Format a clock time `offsetS` seconds after the H-hour base (seconds since midnight). */
export function formatClock(baseSeconds: number, offsetS: number): string {
  const total = (((baseSeconds + Math.round(offsetS)) % 86400) + 86400) % 86400;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

/** "T+Xs" plus " (HH:MM:SS)" when an H-hour base is set. */
export function formatTime(seconds: number, hHourBase: number | null): string {
  const base = `T+${Math.round(seconds)}s`;
  return hHourBase === null ? base : `${base} (${formatClock(hHourBase, seconds)})`;
}

/** Human duration for reposition/wait phases, e.g. "53min" or "1h 7min". */
export function formatDuration(seconds: number): string {
  const totalMin = Math.round(seconds / 60);
  if (totalMin < 1) return `${Math.round(seconds)}s`;
  if (totalMin < 60) return `${totalMin}min`;
  const h = Math.floor(totalMin / 60);
  const rem = totalMin % 60;
  return rem ? `${h}h ${rem}min` : `${h}h`;
}
