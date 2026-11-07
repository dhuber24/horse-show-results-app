/**
 * When exhibitors may move into their stalls (migration 181): `shows.stalls_open_date`
 * and the optional `stalls_open_time`.
 *
 * Both are the venue's own wall-clock day and hour, printed exactly as the show
 * office set them. That is why this does not go through `LocalTime`: there is no
 * instant here to move into the reader's zone — "Stalls open Thursday at noon"
 * means noon at the barn, wherever the exhibitor reads it from.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "12:00:00" → "12:00 PM". Postgres sends a TIME, which `new Date()` cannot
 *  parse on its own, so the parts are read directly. */
export function formatWallClock(value: string): string {
  const [h, m] = value.split(':').map(Number);
  if (!Number.isFinite(h)) return value;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(Number.isFinite(m) ? m : 0).padStart(2, '0')} ${suffix}`;
}

/** "Thursday, May 14 at 12:00 PM", or "Thursday, May 14" with no hour, or null
 *  when the show has not said. The date is read as its parts, since
 *  `new Date('2026-05-14')` is UTC midnight and reads as the 13th west of it. */
export function formatStallsOpen(
  date: string | null | undefined,
  time: string | null | undefined,
): string | null {
  if (!date) return null;
  const [y, mo, d] = date.split('-').map(Number);
  if (!y || !mo || !d) return null;
  const weekday = WEEKDAYS[new Date(y, mo - 1, d).getDay()];
  const day = `${weekday}, ${MONTHS[mo - 1]} ${d}`;
  return time ? `${day} at ${formatWallClock(time)}` : day;
}

/** Whether a picked arrival day comes before the barn opens. Plain string
 *  comparison is right for two yyyy-mm-dd values. */
export function arrivesBeforeStallsOpen(
  arrival: string | null | undefined,
  stallsOpen: string | null | undefined,
): boolean {
  return Boolean(arrival && stallsOpen && arrival < stallsOpen);
}
