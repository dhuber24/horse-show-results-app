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

/** Quantities an exhibitor books at sign-up. */
export const RESERVABLE_FEE_UNITS = [
  'per_stall',
  'per_bag',
  'per_night',
  'per_day',
  'per_show',
] as const satisfies readonly FeeUnit[];

/** Which reservable units may additionally carry an early rate. Mirrors
 *  `EARLY_RATE_FEE_UNITS` in backend/billing.py — bags are the one exception.
 *  A stall or a camping spot has a real reserve-early convention on a paper
 *  show bill; a bag count does not, so the control does not offer one. */
export const EARLY_RATE_FEE_UNITS = RESERVABLE_FEE_UNITS.filter(
  (u) => u !== 'per_bag',
) as readonly FeeUnit[];

/** Which reservable units the show may require a minimum quantity of. Mirrors
 *  `REQUIRABLE_FEE_UNITS` in backend/reservations.py — bedding only. A
 *  minimum is a policy about the grounds ("every stall gets bedded this
 *  deep"), and neither a stall count nor a camping spot is that: an
 *  exhibitor books however many of either they need. */
export const REQUIRABLE_FEE_UNITS = ['per_bag'] as const satisfies readonly FeeUnit[];

export function canHaveEarlyRate(unit: string): boolean {
  return (EARLY_RATE_FEE_UNITS as readonly string[]).includes(unit);
}

export function canHaveMinimumQuantity(unit: string): boolean {
  return (REQUIRABLE_FEE_UNITS as readonly string[]).includes(unit);
}

/** Charges the show applies to every exhibitor who has entered a class,
 *  derived from what they entered and the size of the judge panel. Nobody
 *  books these and there is nothing to tick. */
export const AUTOMATIC_FEE_UNITS = [
  'per_exhibitor',
  'per_horse',
  'per_judge_per_horse',
  'per_judge_per_exhibitor',
  // APHA SC-125.B's assessment, and every breed body's version of it: a fee per
  // class entry per judge that show management collects and forwards.
  'per_judge_per_entry',
  // The show's own fee per class entered, in its ticked classes. Two horses in
  // one class are two entries and two of these. It billed nobody until a show
  // priced its classes this way and the desk read $0 — see billing.py.
  'per_entry',
] as const satisfies readonly FeeUnit[];

/**
 * What each unit is called on screen.
 *
 * A show fee is charged against a *class* — that is the word on every show bill
 * and in every conversation at the desk. "Entry" is the app's own name for the
 * row in `entries`, and a manager reading "per entry" next to "per judge, per
 * class" had two names for one thing. The column values are untouched:
 * `per_entry` is still `per_entry` in the database and in billing.py.
 */
export const UNIT_LABEL: Record<FeeUnit, string> = {
  flat: 'flat',
  per_entry: 'per class',
  per_exhibitor: 'per exhibitor',
  per_horse: 'per horse',
  per_judge_per_horse: 'per judge, per horse',
  per_judge_per_exhibitor: 'per judge, per exhibitor',
  per_judge_per_entry: 'per judge, per class',
  per_class_per_horse: 'per class, per horse',
  per_night: 'per night',
  per_day: 'per day',
  per_stall: 'per stall',
  per_bag: 'per bag',
  per_show: 'per show',
  percent_of_entry: '% of class fee',
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

/** The units the Class Fees box offers for a fee: every automatic unit, and
 *  nothing that bills nobody. `per_class_per_horse` was withdrawn — "per class"
 *  already charges two horses in one class twice, because they are two entries. */
export const CLASS_FEE_UNIT_OPTIONS = AUTOMATIC_FEE_UNITS;

/** The rows the Class Fees box lists: what it offers, plus a row still carrying
 *  the withdrawn `per_class_per_horse`, so it can be seen and switched rather
 *  than turning up on the Boarding Fees screen. */
export const CLASS_FEE_EDITOR_UNITS = [
  ...CLASS_FEE_UNIT_OPTIONS,
  'per_class_per_horse',
] as const satisfies readonly FeeUnit[];

export function isClassFeeEditorUnit(unit: string): boolean {
  return (CLASS_FEE_EDITOR_UNITS as readonly string[]).includes(unit);
}

/**
 * Whether a fee with this unit charges nobody — neither booked at sign-up nor
 * applied automatically, so it is price-list text on the show bill and nothing
 * more. Mirrors the third family in `build_bill` (backend/billing.py).
 *
 * In the Class Fees box that is now only a row still carrying the withdrawn
 * `per_class_per_horse`, and the row says so rather than leaving it to a
 * tooltip: a class list to tick reads exactly like pricing those classes.
 */
export function chargesNobody(unit: string): boolean {
  return !isReservableUnit(unit) && !isAutomaticUnit(unit);
}

/**
 * The units a fee is quoted "per class" in, and so the ones the Class Fees box
 * offers a class list on. Mirrors `PER_CLASS_FEE_UNITS` in backend/billing.py.
 *
 * Every unit whose label says "per class", and only those. Every class is
 * ticked by default and the manager unticks to narrow. `per_entry` and
 * `per_judge_per_entry` bill, and the list narrows the charge; the withdrawn
 * `per_class_per_horse` bills nobody and keeps its list for the show bill.
 * Club-sanctioned and futurity classes are never offered to tick. A per-horse or per-exhibitor charge is about the horse or the person,
 * and gets no list at all.
 */
export const PER_CLASS_FEE_UNITS = [
  'per_entry',
  'per_judge_per_entry',
  'per_class_per_horse',
] as const satisfies readonly FeeUnit[];

export function offersClassList(unit: string): boolean {
  return (PER_CLASS_FEE_UNITS as readonly string[]).includes(unit);
}

/** How a club's sanction fee is charged (migration 133) — `show_sanctioning.
 *  fee_unit`, offered in setup Step 5. Mirrors `billing.CLUB_SANCTION_UNITS`.
 *
 *  The same words as a show fee's, because they mean the same thing and the
 *  backend prices both through one `charge_multiplier`. `per_judge_per_entry`
 *  is the one automatic unit left out: that is the breed body's own per-entry
 *  assessment (APHA SC-125.B and its kin) and belongs to the show's own fee
 *  catalog, and a club billing per class entered is what `per_entry` is here.
 *
 *  `per_entry` leads, because it is what every club charged before the unit
 *  existed and is still the ordinary case. Note it is billed here, unlike a
 *  `per_entry` row in the Class Fees box: what a class entry costs is
 *  `classes.entry_fee_cents`, but a club's sanction fee is a levy on top of it
 *  and has always been charged. */
export const CLUB_SANCTION_UNITS = [
  'per_entry',
  'per_exhibitor',
  'per_horse',
  'per_judge_per_horse',
  'per_judge_per_exhibitor',
] as const satisfies readonly FeeUnit[];

export type ClubSanctionUnit = (typeof CLUB_SANCTION_UNITS)[number];

export function isClubSanctionUnit(unit: string): unit is ClubSanctionUnit {
  return (CLUB_SANCTION_UNITS as readonly string[]).includes(unit);
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

/** A judge on the show's panel, as `GET /shows/{id}/judges/` returns them. */
export type PanelJudge = { associations?: { id: string; code: string }[] | null };

/**
 * How many judges a per-judge fee for one association multiplies by.
 *
 * Mirrors `billing.carded_judge_count`, for the setup previews only: the panel
 * judges carded with that association, or the whole panel when nobody on it is
 * carded with it (a regional club that cards no judges, or a registry where
 * carding has not been recorded). `code` is set only when the count was
 * narrowed, so a preview can say "2 WSCA judges" rather than "2 judges".
 */
export function cardedJudgeCount(
  judges: PanelJudge[],
  association: { id?: string | null; code?: string | null },
): { count: number; code: string | null } {
  const carded = judges.filter((judge) =>
    (judge.associations ?? []).some(
      (a) =>
        (association.id != null && a.id === association.id) ||
        (association.code != null && association.code !== '' && a.code === association.code),
    ),
  ).length;
  if (carded === 0) return { count: judges.length, code: null };
  return { count: carded, code: association.code ?? null };
}

/** The judge count the show's own per-judge charges multiply by: the judges
 *  carded with its breed body, or the whole panel at an Open show. Mirrors
 *  `billing.breed_judge_count`. */
export function breedJudgeCount(judges: PanelJudge[], showTypeCode: string | null | undefined): number {
  if (!showTypeCode || showTypeCode === 'OPEN') return judges.length;
  return cardedJudgeCount(judges, { code: showTypeCode }).count;
}

/** "4 judges", or "2 WSCA judges" when the count is one association's. */
export function judgesLabel(count: number, code: string | null): string {
  return `${count} ${code ? `${code} ` : ''}judge${count === 1 ? '' : 's'}`;
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

/**
 * How a published fee schedule is grouped for someone reading it.
 *
 * A flat list of a show's fees is a column of amounts with a parenthetical unit
 * after each, and working out what a weekend costs from it means knowing that
 * `per_bag` is something you order, `per_judge_per_horse` is something that
 * happens to you, and `flat` is neither. The groups say that out loud, and they
 * are the families `billing.py` already bills by — reserved, automatic, and
 * everything else — split once more where the exhibitor's decision differs
 * (stalls and bedding are ordered by the stall; camping is ordered by the
 * night, day or spot).
 *
 * `note` is what the group's amounts *mean*, not a description of the group.
 * "You choose how many at sign-up" is the sentence that tells somebody whether
 * the number beside it is theirs to control.
 */
export const FEE_GROUPS: {
  key: string;
  heading: string;
  note: string;
  units: FeeUnit[];
}[] = [
  {
    key: 'stalls',
    heading: 'Stalls & bedding',
    note: 'You choose how many when you sign up.',
    units: ['per_stall', 'per_bag'],
  },
  {
    // The three ways a venue prices the same camping spot, under one heading —
    // same reasoning as the sign-up picker (migrations 108, 111). A
    // $60-for-the-weekend hook-up filed away from the nightly rate is one
    // nobody finds.
    key: 'camping',
    heading: 'Camping & hook-ups',
    note: 'You choose how many when you sign up.',
    units: ['per_night', 'per_day', 'per_show'],
  },
  {
    key: 'automatic',
    heading: 'Added to every entry',
    note: 'Charged automatically once you enter a class — nothing to book.',
    units: [
      'per_exhibitor',
      'per_horse',
      'per_judge_per_horse',
      'per_judge_per_exhibitor',
      'per_judge_per_entry',
      'per_entry',
    ],
  },
  {
    // The units in no billing family. Printed because the show published them
    // and somebody at the desk will charge them; labelled honestly because the
    // app does not, and a price list that reads like a bill is worse than one
    // that admits what it is. See the `build_bill` Sharp Edge in Claude.md.
    key: 'other',
    heading: 'Other charges',
    note: 'Published prices. The show office applies these case by case.',
    units: ['flat', 'per_class_per_horse', 'percent_of_entry'],
  },
];

/**
 * Sort a show's fee rows into `FEE_GROUPS`, dropping the groups it has nothing
 * in. A unit that belongs to no group falls into "Other charges" rather than
 * disappearing — a fee the show published and this list has never heard of is
 * still a fee somebody is going to be asked for.
 */
export function groupFees<T extends { unit: string }>(
  fees: T[],
): { key: string; heading: string; note: string; fees: T[] }[] {
  const claimed = new Set(FEE_GROUPS.flatMap((g) => g.units as readonly string[]));
  return FEE_GROUPS.map((group) => ({
    key: group.key,
    heading: group.heading,
    note: group.note,
    fees: fees.filter(
      (fee) =>
        (group.units as readonly string[]).includes(fee.unit) ||
        (group.key === 'other' && !claimed.has(fee.unit)),
    ),
  })).filter((group) => group.fees.length > 0);
}
