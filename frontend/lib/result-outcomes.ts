/**
 * What happened to an entry on one judge's card (migration 121).
 *
 * `results.place` used to be NOT NULL, so every row had to claim a placing and
 * the states below had nowhere to go. They report differently and the sheet has
 * to say which: a blank where a placing should be reads as "not judged yet",
 * which is the one thing none of these mean.
 *
 * `zero_score` is in the running and the others are not — a declared zero is a
 * number the sheet compares, which is the distinction APHA draws against a No
 * Score. `backend/placings.py` holds the same split; keep them together.
 */

export const RESULT_OUTCOMES = [
  {
    value: 'placed',
    label: 'Placed',
    short: '',
    help: 'Ranked from the score.',
  },
  {
    value: 'zero_score',
    label: 'Zero score',
    short: '0',
    help: 'The judge called a zero. Ranked, below everyone who scored.',
  },
  {
    value: 'no_score',
    label: 'No score',
    short: 'NS',
    help: 'No score at all — not the same as a zero.',
  },
  {
    value: 'disqualified',
    label: 'Disqualified',
    short: 'DQ',
    help: 'The judge disqualified this entry.',
  },
  {
    value: 'eliminated',
    label: 'Eliminated',
    short: 'ELIM',
    help: 'Off course, fall, or over the time allowed.',
  },
] as const;

export type ResultOutcome = (typeof RESULT_OUTCOMES)[number]['value'];

/** The outcomes that take part in the ranking — see backend/placings.py. */
export const RANKED_OUTCOMES: ResultOutcome[] = ['placed', 'zero_score'];

export function isRanked(outcome: string | null | undefined): boolean {
  return RANKED_OUTCOMES.includes((outcome ?? 'placed') as ResultOutcome);
}

/**
 * The outcomes worth offering for a class of this kind.
 *
 * A rail class has no score, so there is nothing for a declared zero to be —
 * offering it would invite a scribe to record a number the class never produced.
 */
export function outcomesFor(scoreType: string) {
  if (scoreType === 'placement') {
    return RESULT_OUTCOMES.filter((o) => o.value !== 'zero_score');
  }
  return RESULT_OUTCOMES;
}

/** Short badge text, e.g. 'DQ'. Empty for an ordinary placing. */
export function outcomeShort(outcome: string | null | undefined): string {
  return RESULT_OUTCOMES.find((o) => o.value === outcome)?.short ?? '';
}

/** Full label, e.g. 'Disqualified'. Empty for an ordinary placing. */
export function outcomeLabel(outcome: string | null | undefined): string {
  if (!outcome || outcome === 'placed') return '';
  return RESULT_OUTCOMES.find((o) => o.value === outcome)?.label ?? outcome;
}
