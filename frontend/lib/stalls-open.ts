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

/**
 * The Early Move-In Pass: what an exhibitor pays to move into their stalls
 * before they open. It is an ordinary reservable `show_fees` row, priced per
 * stall, offered with a tick box under *Move-in* on the Lodging step — so the
 * bill, the desk and the price list charge and print it like any other line.
 *
 * Found by `code`, as every Lodging step line is. `early_arrival_stall` is the
 * code the show bill import and the MNSPHC seed gave the same line before the
 * step offered it — "Early arrival — stall, Thursday after 6:00 PM" — so that
 * row is the pass, not a second one beside it.
 */
export const EARLY_MOVE_IN_CODE = 'early_move_in';
export const EARLY_MOVE_IN_CODES: readonly string[] = [EARLY_MOVE_IN_CODE, 'early_arrival_stall'];

/** The show's Early Move-In Pass, if it offers one: its own code first. */
export function earlyMoveInPass<T extends { code: string }>(fees: readonly T[]): T | undefined {
  for (const code of EARLY_MOVE_IN_CODES) {
    const fee = fees.find((f) => f.code === code);
    if (fee) return fee;
  }
  return undefined;
}

/** The hour stalls open when the office has not said: noon. */
export const DEFAULT_STALLS_OPEN_TIME = '12:00';

/** The move-in a show starts with when nothing is on file: the day before its
 *  first day, at noon. Read as date parts and built in UTC so no zone can move
 *  the day, and month and year ends roll over on their own. */
export function defaultMoveIn(showStartDate: string | null | undefined): { date: string; time: string } | null {
  if (!showStartDate) return null;
  const [y, mo, d] = showStartDate.split('-').map(Number);
  if (!y || !mo || !d) return null;
  const dayBefore = new Date(Date.UTC(y, mo - 1, d - 1));
  return { date: dayBefore.toISOString().slice(0, 10), time: DEFAULT_STALLS_OPEN_TIME };
}
