/**
 * The screen's half of the card rule. `cardStanding` is the only real logic
 * here — everything else is a lookup — and the thing worth pinning about it is
 * that it warns *before* the card runs out. A card is renewed annually, so a
 * warning that first appeared on 31 December would be one nobody could act on.
 */
// Globals are imported rather than declared ambiently: `tsconfig.json` includes
// `**/*.ts`, so these files are type-checked by `npm run type-check`, and
// importing from `@jest/globals` keeps that passing without adding
// `@types/jest` to the dependency tree.
import { describe, expect, it } from '@jest/globals';

import {
  APHA_CARD_DIVISIONS,
  cardDivisionLabel,
  cardDivisionsFor,
  cardExpiry,
  cardStanding,
  issuesCards,
} from './competition-cards';

describe('cardExpiry', () => {
  it('is the last day of the card year', () => {
    expect(cardExpiry(2026)).toBe('2026-12-31');
  });
});

describe('cardStanding', () => {
  it('reads a card for a year already gone as expired', () => {
    expect(cardStanding(2025, new Date(2026, 0, 1))).toBe('expired');
  });

  it('reads a card bought ahead as current', () => {
    // Renewing in December is the normal case; a 2027 card is not "expiring".
    expect(cardStanding(2027, new Date(2026, 11, 15))).toBe('current');
  });

  it('warns through the last two months of the card year', () => {
    expect(cardStanding(2026, new Date(2026, 9, 31))).toBe('current');
    expect(cardStanding(2026, new Date(2026, 10, 1))).toBe('expiring');
    expect(cardStanding(2026, new Date(2026, 11, 31))).toBe('expiring');
  });

  it('still calls this year’s card current in the spring', () => {
    expect(cardStanding(2026, new Date(2026, 3, 12))).toBe('current');
  });
});

describe('cardDivisionsFor', () => {
  it('gives APHA the five cards its own notice names', () => {
    expect(cardDivisionsFor('APHA')).toEqual([...APHA_CARD_DIVISIONS]);
  });

  it('offers nothing for an association whose card rules are not on file', () => {
    // Not the same claim as "AQHA issues no cards" — see the module comment.
    expect(cardDivisionsFor('AQHA')).toEqual([]);
    expect(issuesCards('AQHA')).toBe(false);
    expect(issuesCards(null)).toBe(false);
  });

  it('does not care how the code was typed', () => {
    expect(cardDivisionsFor(' apha ')).toEqual([...APHA_CARD_DIVISIONS]);
  });

  it('leaves out the divisions that need no card', () => {
    const apha = cardDivisionsFor('APHA');
    expect(apha).not.toContain('YOUTH');
    expect(apha).not.toContain('YOUTH_WALK_TROT_5_10');
    expect(apha).not.toContain('OPEN');
  });
});

describe('cardDivisionLabel', () => {
  it('writes a division the way the rule book does', () => {
    expect(cardDivisionLabel('YOUTH_WALK_TROT_11_18')).toBe('Youth Walk-Trot 11–18');
    expect(cardDivisionLabel('AMATEUR_WALK_TROT')).toBe('Amateur Walk-Trot');
  });
});
