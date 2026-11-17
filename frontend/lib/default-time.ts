/**
 * The hour every time field in the app starts at: 12:00 PM.
 *
 * A time beside a day — a stall period's move-in and move-out, an Early
 * Move-In Pass's move-in, an early-rate or futurity deadline — is filled in
 * with noon as soon as its day is picked, rather than left blank for the
 * office to fill. A new stall period starts with its hours at noon too. It is
 * a default, not a rule: the hour can be changed or cleared like any other.
 * A time already saved without an hour stays without one until its day is
 * changed, since filling it in would change what a show already told
 * exhibitors.
 */

/** HH:MM, as `<input type="time">` takes it. */
export const DEFAULT_TIME = '12:00';

/**
 * The hour to keep when a day is picked: the one already there, or noon. None
 * when the day is cleared — an hour on no day means nothing.
 */
export function timeForDay(day: string, time: string): string {
  if (!day) return '';
  return time || DEFAULT_TIME;
}
