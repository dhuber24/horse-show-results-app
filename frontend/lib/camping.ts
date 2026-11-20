/**
 * Camping and electrical hook-up options: what the Lodging step's *Camping &
 * hook-ups* card sells. A show may sell more than one — WSCA's Champ Show sells
 * electrical for the full show, Wednesday to Friday, and Friday to Monday, each
 * at its own price — so each option is its own reservable `show_fees` row,
 * named by the office and priced per night, per day or once for the whole show.
 *
 * Found by `code`, as every Lodging step line is: the first option keeps
 * `camping`, the code the step has always given the line (`hookup` before
 * migration 108), and each further one is `camping_` and its name (mirrors
 * `showbill_import.CAMPING_PREFIX`).
 */

export const CAMPING_CODE = 'camping';
export const CAMPING_CODES: readonly string[] = [CAMPING_CODE, 'hookup'];
export const CAMPING_PREFIX = 'camping_';

/** Whether a fee line is one of the show's camping or hook-up options. */
export function isCampingOption(fee: { code: string }): boolean {
  return CAMPING_CODES.includes(fee.code) || fee.code.startsWith(CAMPING_PREFIX);
}

/** A new option's code: `camping` while the show has none, else `camping_`
 *  and its name, unique among `taken`. */
export function campingCode(label: string, taken: ReadonlySet<string>): string {
  if (!CAMPING_CODES.some((c) => taken.has(c))) return CAMPING_CODE;
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const base = `${CAMPING_PREFIX}${slug || 'option'}`.slice(0, 56);
  let code = base;
  for (let n = 2; taken.has(code); n += 1) code = `${base}_${n}`;
  return code;
}
