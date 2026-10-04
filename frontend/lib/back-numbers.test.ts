// Globals are imported rather than declared ambiently: see `safe-next.test.ts`.
import { describe, expect, it } from '@jest/globals';

import { backNumbersLabel, backNumbersOf } from './back-numbers';

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
