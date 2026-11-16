// Globals are imported rather than declared ambiently: see `safe-next.test.ts`.
import { describe, expect, it } from '@jest/globals';

import { compareClassNumbers, dashLabel, hashLabel, hashNumber } from './class-number';

describe('a class with no number', () => {
  it('prints no bare "#" — a Grand & Reserve class is unnumbered', () => {
    expect(hashNumber('')).toBe('');
    expect(hashLabel({ class_number: '', class_name: 'Grand & Reserve Mares' })).toBe('Grand & Reserve Mares');
    expect(dashLabel({ class_number: '', class_name: 'Grand & Reserve Mares' })).toBe('Grand & Reserve Mares');
  });

  it('prints a bill number as the bill printed it', () => {
    expect(hashNumber('5N')).toBe('#5N');
    expect(hashLabel({ class_number: '73N', class_name: 'Trail' })).toBe('#73N Trail');
    expect(dashLabel({ class_number: 12, class_name: 'Trail' })).toBe('12 — Trail');
  });
});

describe('compareClassNumbers', () => {
  it('orders numbers as a reader does, unnumbered last', () => {
    const sorted = ['10', '', '5N', '2', '5'].sort(compareClassNumbers);
    expect(sorted).toEqual(['2', '5', '5N', '10', '']);
  });
});
