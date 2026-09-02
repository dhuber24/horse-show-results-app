// APHA-specific constants and utilities

export const APHA_DIVISIONS = [
  { value: 'OPEN', label: 'Open' },
  { value: 'SOLID_PAINT_BRED', label: 'Solid Paint-Bred' },
  { value: 'AMATEUR', label: 'Amateur' },
  { value: 'NOVICE_AMATEUR', label: 'Novice Amateur' },
  { value: 'AMATEUR_WALK_TROT', label: 'Amateur Walk-Trot' },
  { value: 'YOUTH', label: 'Youth' },
  { value: 'NOVICE_YOUTH', label: 'Novice Youth' },
  { value: 'YOUTH_WALK_TROT_11_18', label: 'Youth Walk-Trot 11–18' },
  { value: 'YOUTH_WALK_TROT_5_10', label: 'Youth Walk-Trot 5–10' },
] as const;

/**
 * How a division reads on screen. `.title()` on the stored value gives "Youth
 * Walk Trot 11 18", which is not what the class list or the rule book calls it.
 * Mirrors `DIVISION_LABELS` in `backend/rules/apha.py`.
 */
export function divisionLabel(value: string): string {
  return APHA_DIVISIONS.find((d) => d.value === value)?.label ?? value;
}

/**
 * How the exhibitor is entitled to show this horse.
 *
 * APHA's ownership rule (AM-300.E, and YP-015 for youth) names roughly twenty
 * relationships, and an exhibitor whose relationship is not on the list has to
 * pick something untrue — which is worse than a blank, because the entry then
 * reads as answered. Grouped rather than flat: twenty-five options in one
 * ungrouped select is a scroll, not a choice.
 *
 * "Leased horse" is here because AM-020.A.1 makes leased horses eligible and
 * this field is the only place an entry can say so. It is not a lease *record* —
 * the term, the lessor and the papers APHA holds are not modeled anywhere.
 */
export const RELATIONSHIP_OPTION_GROUPS = [
  {
    label: 'The exhibitor',
    options: ['Self', 'Leased horse'],
  },
  {
    label: 'Immediate family',
    options: [
      'Spouse',
      'Mother',
      'Father',
      'Son',
      'Daughter',
      'Brother',
      'Sister',
      'Grandparent',
      'Grandchild',
    ],
  },
  {
    label: 'Step and half relations',
    options: [
      'Stepparent',
      'Stepchild',
      'Stepbrother',
      'Stepsister',
      'Half-brother',
      'Half-sister',
      'Step-grandparent',
    ],
  },
  {
    label: 'In-laws',
    options: [
      'Father-in-law',
      'Mother-in-law',
      'Brother-in-law',
      'Sister-in-law',
      'Son-in-law',
      'Daughter-in-law',
    ],
  },
  {
    label: 'Extended family',
    options: ['Aunt', 'Uncle', 'Niece', 'Nephew'],
  },
  {
    label: 'Other',
    options: ['Legal ward', 'Family-owned farm or ranch', 'Family-owned corporation'],
  },
] as const;

/** Flat list, for anything that needs to check a value rather than offer one. */
export const RELATIONSHIP_OPTIONS: readonly string[] =
  RELATIONSHIP_OPTION_GROUPS.flatMap((g) => g.options);

/**
 * Divisions whose eligibility turns on who owns the horse. Mirrors
 * `RELATIONSHIP_REQUIRED_DIVISIONS` in `backend/rules/apha.py` — the backend is
 * what enforces this; the copy here only decides whether to show the field.
 *
 * Open and Solid Paint-Bred are absent on purpose: eligibility there is a
 * property of the horse's registry, and who owns it does not change the answer.
 */
/**
 * Divisions gated on points and prize money — facts the app does not hold and
 * never will. AM-205 decides Novice Amateur per category at the time status is
 * applied for; YP-255.A.1 caps Novice Youth fence-work earnings at $750. Both
 * put the responsibility on the exhibitor and the burden of proof on whoever
 * protests, so the entry carries a declaration rather than a check.
 *
 * Mirrors `ATTESTATION_REQUIRED_DIVISIONS` in `backend/rules/apha.py`, which is
 * what enforces it.
 */
export const ATTESTATION_REQUIRED_DIVISIONS = new Set([
  'NOVICE_AMATEUR',
  'NOVICE_YOUTH',
]);

/**
 * The words shown beside the tickbox. The backend writes its own copy into
 * `entry_attestations.statement` from `ATTESTATION_STATEMENTS`, so this is
 * display only — keep the two in step.
 */
export const NOVICE_ELIGIBILITY_STATEMENT =
  "I declare that this exhibitor is within APHA's point and earnings limits for this " +
  'Novice division as of January 1 of the current show year. Eligibility is the ' +
  "exhibitor's responsibility (APHA AM-205, YP-255.A.1).";

export const RELATIONSHIP_REQUIRED_DIVISIONS = new Set([
  'AMATEUR',
  'NOVICE_AMATEUR',
  'AMATEUR_WALK_TROT',
  'YOUTH',
  'NOVICE_YOUTH',
  'YOUTH_WALK_TROT_11_18',
  'YOUTH_WALK_TROT_5_10',
]);

// ── SC-090: getting the show approved ────────────────────────────────────────

/**
 * The approval application ladder, as the readiness panel labels it.
 *
 * The band itself is decided in `backend/rules/apha.py`, which holds the rule's
 * numbers and the fee each one carries; this is only how the answer reads on
 * screen. Keep the two in step, the way `NOVICE_ELIGIBILITY_STATEMENT` is kept
 * in step with `ATTESTATION_STATEMENTS`.
 */
export const APPLICATION_BANDS = {
  standard: { label: 'Standard window', tone: 'ok' },
  late: { label: 'Late — penalty fee per judge', tone: 'warn' },
  late_second: { label: 'Late — larger penalty fee per judge', tone: 'warn' },
  closed: { label: 'Closed — APHA will not approve', tone: 'bad' },
} as const;

export type ApplicationBand = keyof typeof APPLICATION_BANDS;

/**
 * Which date the count runs to. Reported rather than hidden: with no entry
 * deadline on file the app can only count from the show's first day, and
 * SC-090.C allows that only when it is the earlier of the two — so the panel has
 * to be able to say which one it used.
 */
export const APPLICATION_BASIS_LABELS = {
  start_date: 'first day of the show',
  entry_deadline: 'entry deadline',
} as const;

export type AphaApplicationWindow = {
  basis: keyof typeof APPLICATION_BASIS_LABELS;
  basis_date: string;
  standard_deadline: string;
  days_remaining: number;
  band: ApplicationBand;
};

/**
 * SC-095.A — what a three-or-more-judge show has to offer.
 *
 * `open_halter_unclassified` is the honest half of this. "Open division" is not a
 * column and neither is halter's 2-and-under / 3-and-over split, so both are read
 * out of the class name and its bracket; a Grand & Reserve Champion class is Open
 * halter with no age in it and belongs on a list rather than in a false finding.
 *
 * `performance_confirmed` counts the classes whose discipline is one SC-190.A
 * enumerates, and is what the requirement is judged on.
 * `performance_upper_bound` — everything that is not halter — is kept beside it
 * so the panel can show how many classes were not matched, and therefore how
 * much of the count rests on the classifier having routed them correctly.
 */
export type AphaShowMinimums = {
  judge_count: number;
  applies: boolean;
  required_performance: number;
  open_junior_halter: string[];
  open_senior_halter: string[];
  open_halter_unclassified: string[];
  performance_confirmed: number;
  performance_upper_bound: number;
  /** Set when SC-105.C.3 lifts the requirement — a two-judge show offered with a
   *  clinic. `applies` is already false; this says which rule did it, because
   *  "not required" and "under three judges" are different answers. */
  exempt_reason: string | null;
};

/**
 * SC-125.A — how long the office has to file the show's results.
 *
 * Null until the show's last day: there is nothing to file before then, and a
 * countdown running for eleven months is noise on every screen it reaches.
 * `days_remaining` goes negative once the deadline passes.
 *
 * The app cannot see a postmark, so none of this says the results were not
 * sent — only that the date has gone by.
 */
export const RESULTS_BANDS = {
  open: { label: 'Within the ten-day window', tone: 'ok' },
  late: { label: 'Past ten days — a late fee is assessed', tone: 'warn' },
  delinquent: { label: 'Past thirty days — listed in the Paint Horse Journal', tone: 'bad' },
} as const;

export type ResultsBand = keyof typeof RESULTS_BANDS;

export type AphaResultsWindow = {
  due: string;
  delinquent_after: string;
  days_remaining: number;
  band: ResultsBand;
};
