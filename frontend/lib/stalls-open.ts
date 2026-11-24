/**
 * When exhibitors may move into their stalls (migration 181): `shows.stalls_open_date`
 * and the optional `stalls_open_time`.
 *
 * Both are the venue's own wall-clock day and hour, printed exactly as the show
 * office set them. That is why this does not go through `LocalTime`: there is no
 * instant here to move into the reader's zone — "Stalls open Thursday at noon"
 * means noon at the barn, wherever the exhibitor reads it from.
 */

import { unitLabel } from './fee-units';

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
 * before they open. It is an ordinary reservable `show_fees` row, offered with a
 * tick box on the Lodging step's *Stalls & move-in* card — so the bill, the desk
 * and the price list charge and print it like any other line.
 *
 * Move-in is set only by stall period, so a show offers one pass per period,
 * each the office's choice (migration 196): code `early_move_in_<period>`,
 * carrying the period's id. Each is priced per stall or once per exhibitor
 * (`one_per_exhibitor`), and moves holders in at a day of its own
 * (`move_in_date` / `move_in_time`, migration 195), optionally until a day and
 * hour of its own (`move_in_end_date` / `move_in_end_time`, migration 203). A whole-show pass — code
 * `early_move_in`, no period — is one from before stall periods, or one the
 * show bill import read; the Lodging step moves it into the first period
 * unless exhibitors have booked it as it is.
 *
 * Found by `code`, as every Lodging step line is. `early_arrival_stall` is the
 * code the show bill import and the MNSPHC seed gave the whole-show pass before
 * the step offered it — "Early arrival — stall, Thursday after 6:00 PM" — so
 * that row is the pass, not a second one beside it.
 */
export const EARLY_MOVE_IN_CODE = 'early_move_in';
export const EARLY_MOVE_IN_CODES: readonly string[] = [EARLY_MOVE_IN_CODE, 'early_arrival_stall'];
/** A stall period's own pass: `early_move_in_` and a few characters of the
 *  period's id (mirrors `stabling.EARLY_MOVE_IN_PREFIX`). */
export const EARLY_MOVE_IN_PREFIX = 'early_move_in_';

/** Whether a fee line is an Early Move-In Pass, the whole show's or a period's. */
export function isEarlyMoveInPass(fee: { code: string }): boolean {
  return EARLY_MOVE_IN_CODES.includes(fee.code) || fee.code.startsWith(EARLY_MOVE_IN_PREFIX);
}

/**
 * How many of an Early Move-In Pass a booking allows, and how many stalls back
 * it: one pass per stall booked in the pass's own period (any period, for the
 * whole show's pass) — box, tie or tack, since a tack stall moves in too — or,
 * for a pass sold per exhibitor, one once there is any such stall. Never below
 * `saved`, what is already on file: only adding a pass is refused. Null for a
 * line that is not a pass. Mirrors `stabling.pass_refusal`, which enforces it
 * on the exhibitor's sign-up and the desk's bookings alike.
 */
export function passAllowance(
  pass: { code: string; stall_period_id?: string | null; one_per_exhibitor?: boolean },
  lines: readonly { id: string; code: string; unit: string; stall_kind?: string | null; stall_period_id?: string | null }[],
  quantities: Readonly<Record<string, number>>,
  saved = 0,
): { cap: number; stalls: number } | null {
  if (!isEarlyMoveInPass(pass)) return null;
  const stalls = lines
    .filter(
      (line) =>
        line.unit === 'per_stall' &&
        !isEarlyMoveInPass(line) &&
        line.stall_kind !== 'add_on' &&
        (pass.stall_period_id == null || line.stall_period_id === pass.stall_period_id),
    )
    .reduce((n, line) => n + (quantities[line.id] ?? 0), 0);
  const cap = pass.one_per_exhibitor ? (stalls > 0 ? 1 : 0) : stalls;
  return { cap: Math.max(cap, saved), stalls };
}

/** The whole show's Early Move-In Pass, if it offers one: its own code first.
 *  A period's pass is not this one — see `periodPass`. */
export function earlyMoveInPass<T extends { code: string; stall_period_id?: string | null }>(
  fees: readonly T[],
): T | undefined {
  for (const code of EARLY_MOVE_IN_CODES) {
    const fee = fees.find((f) => f.code === code && !f.stall_period_id);
    if (fee) return fee;
  }
  return undefined;
}

/** A stall period's own Early Move-In Pass, if the office offers one for it. */
export function periodPass<T extends { code: string; stall_period_id?: string | null }>(
  fees: readonly T[],
  periodId: string,
): T | undefined {
  return fees.find((f) => isEarlyMoveInPass(f) && f.stall_period_id === periodId);
}

/** How a pass is priced, as the price is printed: "per stall" or "per
 *  exhibitor" (migration 196). */
export function passBasisLabel(pass: { unit: string; one_per_exhibitor?: boolean }): string {
  return pass.one_per_exhibitor ? 'per exhibitor' : unitLabel(pass.unit);
}

/** A pass's move-in window as the API sends it (migrations 195 and 203). */
export type PassWindow = {
  move_in_date?: string | null;
  move_in_time?: string | null;
  move_in_end_date?: string | null;
  move_in_end_time?: string | null;
};

/**
 * When Early Move-In Pass holders may move in (migration 195) and until when
 * (migration 203), printed the way the move-in day is — "Wednesday, September
 * 23 at 2:00 PM until 4:00 PM", the end's day said only when it is another day
 * — or null when the office has not said, which leaves the pass reading
 * "before stalls open". An end with no start is not printed.
 */
export function passMoveIn(pass: PassWindow | null | undefined): string | null {
  if (!pass) return null;
  const from = formatStallsOpen(pass.move_in_date, pass.move_in_time);
  if (!from) return null;
  const endDate = pass.move_in_end_date;
  if (!endDate) return from;
  if (endDate === pass.move_in_date) {
    return pass.move_in_end_time ? `${from} until ${formatWallClock(pass.move_in_end_time)}` : from;
  }
  const until = formatStallsOpen(endDate, pass.move_in_end_time);
  return until ? `${from} until ${until}` : from;
}

/**
 * Whether pass holders move in before stalls open, which is the whole point of
 * the pass. True when there is nothing to compare. On the same day it needs
 * both hours to say yes: "stalls open Friday" with no hour gives an 8 AM pass
 * on that Friday nothing to beat.
 */
export function passMovesInFirst(
  passDate: string | null | undefined,
  passTime: string | null | undefined,
  openDate: string | null | undefined,
  openTime: string | null | undefined,
): boolean {
  if (!passDate || !openDate) return true;
  if (passDate !== openDate) return passDate < openDate;
  return Boolean(passTime && openTime && passTime.slice(0, 5) < openTime.slice(0, 5));
}

/** The hour stalls open when the office has not said: noon. */
export const DEFAULT_STALLS_OPEN_TIME = '12:00';

/**
 * The move-in an Early Move-In Pass starts with when none is on file
 * (migration 195): the day before its stall period moves in, at the hour it
 * moves in — a pass is a day early unless the office says otherwise — or at
 * noon when the period moves in on a day with no hour. Null with no move-in
 * day: there is nothing to be early for. Read as date parts and built in UTC, as `defaultMoveIn` is.
 */
export function defaultPassMoveIn(
  openDate: string | null | undefined,
  openTime: string | null | undefined,
): { date: string; time: string } | null {
  if (!openDate) return null;
  const [y, mo, d] = openDate.split('-').map(Number);
  if (!y || !mo || !d) return null;
  const dayBefore = new Date(Date.UTC(y, mo - 1, d - 1));
  return {
    date: dayBefore.toISOString().slice(0, 10),
    time: (openTime || DEFAULT_STALLS_OPEN_TIME).slice(0, 5),
  };
}

/** When a show's first stall period moves in unless the office says otherwise:
 *  the day before its first day, at noon. Read as date parts and built in UTC
 *  so no zone can move the day, and month and year ends roll over on their own. */
export function defaultMoveIn(showStartDate: string | null | undefined): { date: string; time: string } | null {
  if (!showStartDate) return null;
  const [y, mo, d] = showStartDate.split('-').map(Number);
  if (!y || !mo || !d) return null;
  const dayBefore = new Date(Date.UTC(y, mo - 1, d - 1));
  return { date: dayBefore.toISOString().slice(0, 10), time: DEFAULT_STALLS_OPEN_TIME };
}
