/**
 * Who a back number belongs to at a show (`shows.back_number_per`): each
 * exhibitor; each horse, whoever shows it (migration 161); or each exhibitor
 * on each horse, so two riders of one horse wear two numbers (migration 178).
 */
export type BackNumberPer = 'exhibitor' | 'horse' | 'pair';

/** Whether each horse an exhibitor shows carries its own number here, rather
 *  than the exhibitor carrying one. Unset is a payload from before migration
 *  161, when every show numbered exhibitors. */
export function numbersEachHorse(per: BackNumberPer | null | undefined): boolean {
  return per === 'horse' || per === 'pair';
}

/** One number beside a horse, in one exhibitor's list. */
export type HorseNumberSlot = { exhibitorId: string; horseId: string };

/**
 * Whether two horse rows carry the one number: the same horse, at a show that
 * numbers horses — a horse shown by two exhibitors is a row under each of them
 * with one number between them — or the same exhibitor on the same horse, at
 * one that numbers pairs, where the other rider of that horse has a number of
 * their own.
 */
export function sameHorseNumber(
  per: BackNumberPer | null | undefined,
  a: HorseNumberSlot,
  b: HorseNumberSlot,
): boolean {
  if (a.horseId !== b.horseId) return false;
  return per === 'horse' || a.exhibitorId === b.exhibitorId;
}

/**
 * Every back number one exhibitor wears, as one label.
 *
 * At a show that numbers horses or pairs (`shows.back_number_per`, migrations
 * 161 and 178) an exhibitor wears a number per horse, so an exhibitor-level
 * row — an account, a side pot buy-in, a show in My Shows — carries
 * `back_numbers` beside the old single `back_number` (the lowest of them).
 * Reading only `back_number` there shows "112" for somebody who also wears 113.
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
