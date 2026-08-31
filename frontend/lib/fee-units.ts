/**
 * What a `show_fees` row's unit means, in one place.
 *
 * Three screens edited fee rows and each carried its own copy of this list, so
 * `per_judge` was rendered as "per judge" on one and "x 3 = $15/horse" on
 * another while the backend billed neither. The vocabulary is the whole content
 * of the unit column — see the COMMENT migration 112 puts on it, and
 * `RESERVABLE_FEE_UNITS` / `AUTOMATIC_FEE_UNITS` in backend/billing.py, which
 * these mirror.
 */

export type FeeUnit =
  | 'flat'
  | 'per_entry'
  | 'per_exhibitor'
  | 'per_horse'
  | 'per_judge_per_horse'
  | 'per_judge_per_exhibitor'
  | 'per_judge_per_entry'
  | 'per_class_per_horse'
  | 'per_night'
  | 'per_day'
  | 'per_stall'
  | 'per_bag'
  | 'per_show'
  | 'percent_of_entry';

/** Quantities an exhibitor books at sign-up. The only units that may carry an
 *  early rate, because an early rate is chosen by the day a line was booked. */
export const RESERVABLE_FEE_UNITS = [
  'per_stall',
  'per_bag',
  'per_night',
  'per_day',
  'per_show',
] as const satisfies readonly FeeUnit[];

/** Charges the show applies to every exhibitor who has entered a class,
 *  derived from what they entered and the size of the judge panel. Nobody
 *  books these and there is nothing to tick. */
export const AUTOMATIC_FEE_UNITS = [
  'per_exhibitor',
  'per_horse',
  'per_judge_per_horse',
  'per_judge_per_exhibitor',
  // APHA SC-125.B's assessment, and every breed body's version of it: a fee per
  // class entry per judge that show management collects and forwards. Not the
  // same as `per_entry`, which is class-fee vocabulary and bills nobody.
  'per_judge_per_entry',
] as const satisfies readonly FeeUnit[];

export const UNIT_LABEL: Record<FeeUnit, string> = {
  flat: 'flat',
  per_entry: 'per entry',
  per_exhibitor: 'per exhibitor',
  per_horse: 'per horse',
  per_judge_per_horse: 'per judge, per horse',
  per_judge_per_exhibitor: 'per judge, per exhibitor',
  per_judge_per_entry: 'per judge, per entry',
  per_class_per_horse: 'per class, per horse',
  per_night: 'per night',
  per_day: 'per day',
  per_stall: 'per stall',
  per_bag: 'per bag',
  per_show: 'per show',
  percent_of_entry: '% of entry',
};

export function unitLabel(unit: string): string {
  return UNIT_LABEL[unit as FeeUnit] ?? unit.replace(/_/g, ' ');
}

export function isReservableUnit(unit: string): boolean {
  return (RESERVABLE_FEE_UNITS as readonly string[]).includes(unit);
}

export function isAutomaticUnit(unit: string): boolean {
  return (AUTOMATIC_FEE_UNITS as readonly string[]).includes(unit);
}

/**
 * How many of an automatic charge one exhibitor owes.
 *
 * Mirrors `billing.charge_multiplier`. Used only to *preview* the arithmetic
 * on the setup screen — what anybody is actually billed comes from the backend,
 * for the reason billing.py exists.
 */
export function chargeMultiplier(
  unit: string,
  horseCount: number,
  judgeCount: number,
  entryCount = 0,
): number {
  switch (unit) {
    case 'per_exhibitor':
      return 1;
    case 'per_horse':
      return horseCount;
    case 'per_judge_per_exhibitor':
      return judgeCount;
    case 'per_judge_per_horse':
      return judgeCount * horseCount;
    case 'per_judge_per_entry':
      return judgeCount * entryCount;
    default:
      return 0;
  }
}

/** Whether this unit's charge scales with the judge panel — which is what makes
 *  a show with no judges assigned yet bill nothing for it. */
export function usesJudgeCount(unit: string): boolean {
  return (
    unit === 'per_judge_per_horse' ||
    unit === 'per_judge_per_exhibitor' ||
    unit === 'per_judge_per_entry'
  );
}
