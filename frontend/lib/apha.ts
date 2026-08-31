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
