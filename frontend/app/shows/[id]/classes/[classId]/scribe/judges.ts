/**
 * Per-judge cards, shared by both scribe forms.
 *
 * A class is placed once per judge (migration 095). Everything here keys on a
 * *card key* rather than a raw judge id so the unattributed card — a show with
 * no panel assigned, or results that pre-date the migration — is a first-class
 * case instead of a `null` threaded through every lookup.
 */

export interface ShowJudge {
  id: string;
  first_name: string;
  last_name: string;
}

export interface JudgeCard {
  key: string;
  /** null on the unattributed card, which is what the API wants for judge_id. */
  judgeId: string | null;
  label: string;
  /** Short label for the tab strip, e.g. "J1". */
  shortLabel: string;
}

/** The card key for results with no judge attached. */
export const NO_JUDGE = '__none__';

export function cardKey(judgeId: string | null | undefined): string {
  return judgeId ?? NO_JUDGE;
}

/**
 * The cards this class should offer.
 *
 * One per assigned judge, in the panel's running order. A show with no judges
 * assigned still gets a single unattributed card — the scribe must be able to
 * take placings whether or not the office has finished setting up the panel.
 *
 * `hasUnattributed` adds that card back on a show that *does* have a panel, and
 * it is not an edge case: results entered before the panel was assigned, and
 * results that pre-date migration 095 on a multi-judge show, are both stored
 * with a NULL judge. They show on the public page, so leaving them off here
 * would put placings on the results screen that no scribe could correct.
 */
export function buildCards(judges: ShowJudge[], hasUnattributed = false): JudgeCard[] {
  if (judges.length === 0) {
    return [{ key: NO_JUDGE, judgeId: null, label: 'Placings', shortLabel: 'Card' }];
  }
  const cards = judges.map((j, i) => ({
    key: j.id,
    judgeId: j.id as string | null,
    label: `${j.first_name} ${j.last_name}`,
    shortLabel: `J${i + 1}`,
  }));
  if (hasUnattributed) {
    cards.push({ key: NO_JUDGE, judgeId: null, label: 'Unassigned', shortLabel: '—' });
  }
  return cards;
}

/** Group whatever the results endpoint returned into one bucket per card. */
export function groupByCard<T extends { judge_id?: string | null }>(
  results: T[],
): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const r of results) {
    const key = cardKey(r.judge_id);
    (out[key] ??= []).push(r);
  }
  return out;
}
