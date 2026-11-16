/**
 * A class's number as it is printed next to its name.
 *
 * A class can have no number (`class_number` is ""): a Grand & Reserve champion
 * class is called back into, not entered, and a show bill does not number it —
 * nor does GaitDesk (`backend/class_numbers.py`). A show read off its bill also
 * keeps the bill's numbers as printed, so a number is text — "12", "5N", "2-3".
 * These keep an unnumbered class from printing as a bare "#" or "Class  ()".
 */

type Numbered = { class_number?: string | number | null; class_name: string };

function numberOf(value: string | number | null | undefined): string {
  return value == null ? '' : String(value).trim();
}

/** "#12", or "" for a class with no number. */
export function hashNumber(value: string | number | null | undefined): string {
  const n = numberOf(value);
  return n ? `#${n}` : '';
}

/** "#12 Western Pleasure", or just the name for a class with no number. */
export function hashLabel(cls: Numbered): string {
  const n = numberOf(cls.class_number);
  return n ? `#${n} ${cls.class_name}` : cls.class_name;
}

/** "#12" where a class has a number, its name where it has none — for a
 *  list of classes ("#4, #5") that must still say which one is meant. */
export function hashOrName(cls: {
  class_number?: string | number | null;
  class_name?: string | null;
}): string {
  const n = numberOf(cls.class_number);
  return n ? `#${n}` : (cls.class_name ?? '');
}

/** "#12 · Western Pleasure", or just the name for a class with no number. */
export function dotLabel(cls: Numbered): string {
  const n = numberOf(cls.class_number);
  return n ? `#${n} · ${cls.class_name}` : cls.class_name;
}

/** "12 — Western Pleasure", or just the name for a class with no number. */
export function dashLabel(cls: Numbered): string {
  const n = numberOf(cls.class_number);
  return n ? `${n} — ${cls.class_name}` : cls.class_name;
}

/** Orders printed numbers the way a reader does: 2 before 10, 5 before 5N.
 *  A class with no number sorts last. */
export function compareClassNumbers(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
): number {
  const x = numberOf(a);
  const y = numberOf(b);
  if (!x || !y) return x ? -1 : y ? 1 : 0;
  return x.localeCompare(y, undefined, { numeric: true });
}
