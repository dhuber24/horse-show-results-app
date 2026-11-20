/**
 * Parking and other permits: what the show office charges for a vehicle or
 * other thing on the grounds — a parking permit, a side-by-side, an additional
 * vehicle. Set on the Lodging step's *Parking & permits* card and booked by the
 * exhibitor at sign-up under their own heading.
 *
 * Each is an ordinary reservable `show_fees` row, so the bill, the desk and the
 * price list charge and print it like any other line. Found by `code`, as every
 * Lodging step line is: a permit's code starts `permit_` (mirrors
 * `showbill_import.PERMIT_PREFIX`, which gives a bill's parking and permit lines
 * one). Priced once per permit for the whole show (`per_show`) or by the day
 * (`per_day`).
 */

export const PERMIT_PREFIX = 'permit_';

/** The ways a permit is priced, as the Lodging card offers them. */
export const PERMIT_UNITS = ['per_show', 'per_day'] as const;
export type PermitUnit = (typeof PERMIT_UNITS)[number];

/** Whether a fee line is a permit. */
export function isPermit(fee: { code: string }): boolean {
  return fee.code.startsWith(PERMIT_PREFIX);
}

/** A new permit's code: `permit_` and its name, unique among `taken`. */
export function permitCode(label: string, taken: ReadonlySet<string>): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const base = `${PERMIT_PREFIX}${slug || 'permit'}`.slice(0, 56);
  let code = base;
  for (let n = 2; taken.has(code); n += 1) code = `${base}_${n}`;
  return code;
}

/** What one of a permit line counts at sign-up: a permit, or a day of one. */
export function permitNoun(unit: string): string {
  return unit === 'per_day' ? 'day' : 'permit';
}
