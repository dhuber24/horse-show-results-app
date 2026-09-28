/**
 * How each class is placed — the four card types (migration 155).
 *
 * The vocabulary the Scoring step offers. What each maps to, and which one a
 * class nobody has set derives, is the backend's (`backend/card_types.py`);
 * the class list carries the result as `effective_card_type`.
 */

export type CardType = 'placing' | 'scored' | 'equitation' | 'timed';

export const CARD_TYPES: { key: CardType; label: string; short: string; description: string }[] = [
  {
    key: 'placing',
    label: 'Placing Cards',
    short: 'Placing',
    description: 'Standard rank-order cards marked with final rankings — 1st, 2nd, 3rd — for rail classes.',
  },
  {
    key: 'scored',
    label: 'Scored / Numeric Cards',
    short: 'Scored',
    description:
      'Detailed point sheets for judged-performance classes like Reining, Cutting, Trail or Hunter Over Fences, where each maneuver or jump receives a numerical score and deductions.',
  },
  {
    key: 'equitation',
    label: 'Equitation / Pattern Cards',
    short: 'Equitation',
    description:
      'Sheets breaking down rider position, accuracy and precision through a designated ground or mounted pattern — showmanship, horsemanship, equitation.',
  },
  {
    key: 'timed',
    label: 'Timed',
    short: 'Timed',
    description: 'The clock places the class — barrels, poles, stakes.',
  },
];

export function cardTypeLabel(key: string | null | undefined): string {
  return CARD_TYPES.find((t) => t.key === key)?.label ?? 'Placing Cards';
}

/** Scored and equitation cards place by a score, so they can carry a
 *  judge's-card sheet; a placing card is a ranking and a timed class a clock. */
export function takesSheet(key: CardType): boolean {
  return key === 'scored' || key === 'equitation';
}

/** Whether a sheet belongs on a class of this card type. A sheet no card type
 *  claims is offered to both score-based ones — mirrors `sheet_fits`. */
export function sheetFits(key: CardType, sheetCardType: string | null | undefined): boolean {
  return takesSheet(key) && (sheetCardType == null || sheetCardType === key);
}
