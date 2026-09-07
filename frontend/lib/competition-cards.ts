/**
 * Competition cards — which associations issue them, and the one date they all
 * expire on.
 *
 * APHA gates five divisions on a card rather than on age or membership alone,
 * and every one of them runs 1 January to 31 December and is renewed annually:
 * "Amateur cards run January 1–December 31 and must be renewed annually"
 * (apha.com/competition/amateurs), and on APHA's own entry form, "ALL APHA
 * AMATEUR, NOVICE AMATEUR, AMATEUR WALK TROT, NOVICE YOUTH AND YOUTH WALK TROT
 * 11-18 CARDS EXPIRE DECEMBER 31ST".
 *
 * So the exhibitor is asked for a **year**, never a date. `cardExpiry()` is here
 * only to print what the backend already derived; the row's authority is its
 * year. YOUTH and Youth Walk-Trot 5–10 are deliberately not on the list — APHA's
 * notice does not name them, youth eligibility being age and youth membership.
 *
 * Mirrors `CARD_DIVISIONS_BY_ASSOCIATION` in `backend/competition_cards.py`,
 * which is what checks a card that arrives. Keep the two in step: an
 * association absent from both issues no card this app can describe, which is
 * not the same claim as issuing none.
 */
import { divisionLabel } from './apha';

export const APHA_CARD_DIVISIONS = [
  'AMATEUR',
  'NOVICE_AMATEUR',
  'AMATEUR_WALK_TROT',
  'NOVICE_YOUTH',
  'YOUTH_WALK_TROT_11_18',
] as const;

export const CARD_DIVISIONS_BY_ASSOCIATION: Record<string, readonly string[]> = {
  APHA: APHA_CARD_DIVISIONS,
};

/** The divisions this association issues a card for. Empty is a real answer. */
export function cardDivisionsFor(associationCode: string | null | undefined): readonly string[] {
  if (!associationCode) return [];
  return CARD_DIVISIONS_BY_ASSOCIATION[associationCode.trim().toUpperCase()] ?? [];
}

export function issuesCards(associationCode: string | null | undefined): boolean {
  return cardDivisionsFor(associationCode).length > 0;
}

/** How a card division reads on screen. Borrowed, not restated. */
export const cardDivisionLabel = divisionLabel;

/** 31 December of the competition year — the whole rule. */
export function cardExpiry(validYear: number): string {
  return `${validYear}-12-31`;
}

export type CardStanding = 'current' | 'expiring' | 'expired';

/**
 * Where the card stands **today**, which is the only date the profile has to
 * judge against — it has no show in hand, the same exception the profile horse
 * card already makes for health paperwork. A show office asks the harder
 * question against the show's own end date.
 *
 * `expiring` is the last two months of the card's year: a card is renewed
 * annually and the renewal is the thing to prompt, so a warning that only
 * appeared on 31 December would be a warning nobody could act on in time.
 */
export function cardStanding(validYear: number, today = new Date()): CardStanding {
  const year = today.getFullYear();
  if (validYear < year) return 'expired';
  if (validYear > year) return 'current';
  return today.getMonth() >= 10 ? 'expiring' : 'current';
}
