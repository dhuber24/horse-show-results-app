// Globals are imported rather than declared ambiently: see `safe-next.test.ts`.
import { describe, expect, it } from '@jest/globals';

import { backNumbersLabel, backNumbersOf, numbersEachHorse, sameHorseNumber } from './back-numbers';

describe('backNumbersOf', () => {
  it('lists every number an exhibitor wears at a horse-numbered show', () => {
    expect(backNumbersOf({ back_number: 112, back_numbers: [112, 113] })).toEqual([112, 113]);
  });

  it('falls back to the single number for a payload from before migration 161', () => {
    expect(backNumbersOf({ back_number: 42 })).toEqual([42]);
  });

  it('is empty when nothing is assigned', () => {
    expect(backNumbersOf({ back_number: null, back_numbers: [] })).toEqual([]);
    expect(backNumbersOf({ back_number: null })).toEqual([]);
  });
});

describe('backNumbersLabel', () => {
  it('joins several numbers, each with the prefix', () => {
    expect(backNumbersLabel({ back_number: 112, back_numbers: [112, 113] }, '#')).toBe('#112, #113');
  });

  it('reads one number plainly', () => {
    expect(backNumbersLabel({ back_number: 7, back_numbers: [7] })).toBe('7');
  });

  it('is null for none, so a caller can print its own dash', () => {
    expect(backNumbersLabel({ back_number: null })).toBeNull();
  });
});

describe('numbersEachHorse', () => {
  it('puts a number beside each horse at a show that numbers horses or pairs', () => {
    expect(numbersEachHorse('horse')).toBe(true);
    expect(numbersEachHorse('pair')).toBe(true);
  });

  it('gives the exhibitor the one number otherwise, a payload from before migration 161 included', () => {
    expect(numbersEachHorse('exhibitor')).toBe(false);
    expect(numbersEachHorse(undefined)).toBe(false);
    expect(numbersEachHorse(null)).toBe(false);
  });
});

describe('sameHorseNumber', () => {
  const youthOnDandy = { exhibitorId: 'youth', horseId: 'dandy' };
  const amateurOnDandy = { exhibitorId: 'amateur', horseId: 'dandy' };
  const youthOnPistol = { exhibitorId: 'youth', horseId: 'pistol' };

  it('shares one number between two riders of a horse at a horse-numbered show', () => {
    expect(sameHorseNumber('horse', youthOnDandy, amateurOnDandy)).toBe(true);
  });

  it('gives each rider of a horse a number of their own at a pair-numbered show', () => {
    expect(sameHorseNumber('pair', youthOnDandy, amateurOnDandy)).toBe(false);
    expect(sameHorseNumber('pair', youthOnDandy, { ...youthOnDandy })).toBe(true);
  });

  it('never shares a number between two horses', () => {
    expect(sameHorseNumber('horse', youthOnDandy, youthOnPistol)).toBe(false);
    expect(sameHorseNumber('pair', youthOnDandy, youthOnPistol)).toBe(false);
  });
});
