/**
 * Every back number one exhibitor wears, as one label.
 *
 * At a show that numbers horses (`shows.back_number_per = 'horse'`, migration
 * 161) an exhibitor wears a number per horse, so an exhibitor-level row —
 * an account, a side pot buy-in, a show in My Shows — carries `back_numbers`
 * beside the old single `back_number` (the lowest of them). Reading only
 * `back_number` there shows "112" for somebody who also wears 113.
 *
 * `back_numbers` is optional so a payload from before the change still
 * renders from `back_number`.
 */
export type WithBackNumbers = {
  back_number: number | null;
  back_numbers?: number[];
};

export function backNumbersOf(row: WithBackNumbers): number[] {
  if (row.back_numbers && row.back_numbers.length > 0) return row.back_numbers;
  return row.back_number != null ? [row.back_number] : [];
}

/** "112, 113", or null for none. `prefix` goes before each number ("#"). */
export function backNumbersLabel(row: WithBackNumbers, prefix = ''): string | null {
  const numbers = backNumbersOf(row);
  return numbers.length > 0 ? numbers.map((n) => `${prefix}${n}`).join(', ') : null;
}
