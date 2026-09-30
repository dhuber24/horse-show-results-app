/**
 * Whether an exhibitor is a minor, for the registration screen.
 *
 * The screen's half of the rule: `backend/exhibitor_profile.py` (`is_minor`)
 * is what `PUT /signup` refuses on, and adds the `parent_guardian` checklist
 * row for anybody under 18 on the show's first day. This only decides, as a
 * date of birth is typed, whether the guardian boxes carry an asterisk — so the
 * two must count a birthday the same way.
 */

/** Adults sign for themselves from this birthday on. */
export const ADULT_AGE = 18;

/** Today as `YYYY-MM-DD` in the reader's own zone. */
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Whole years old on `asOf`, birthday and all — a person's real age, not
 * YP-075's 1 January age and not a horse's calendar age. Null when either date
 * is not a `YYYY-MM-DD` string.
 */
export function ageOn(dateOfBirth: string, asOf: string): number | null {
  const born = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth);
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(asOf);
  if (!born || !day) return null;
  const [by, bm, bd] = born.slice(1).map(Number);
  const [y, m, d] = day.slice(1).map(Number);
  let years = y - by;
  if (m < bm || (m === bm && d < bd)) years -= 1;
  return years;
}

/**
 * Under 18 on `asOf`. False while the date of birth is empty or unreadable:
 * nobody is asked for a guardian on a guess about their age, and an empty date
 * of birth is already required in its own right.
 */
export function isMinorOn(dateOfBirth: string, asOf: string): boolean {
  const age = ageOn(dateOfBirth, asOf);
  return age !== null && age < ADULT_AGE;
}
