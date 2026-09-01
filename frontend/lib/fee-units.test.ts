/**
 * How a published fee schedule reads.
 *
 * The grouping is the only thing standing between an exhibitor and a column of
 * amounts they cannot tell apart — a bag of shavings they order, a per-judge
 * assessment that simply arrives, and a stall-cleanout penalty the app never
 * charges anybody all look identical as "$25 (per …)". The cases below are the
 * ones where getting it wrong would put a fee under a heading that lies about
 * whether the exhibitor controls it.
 */
// Globals are imported rather than declared ambiently: `tsconfig.json` includes
// `**/*.ts`, so this file is type-checked by `npm run type-check`, and
// importing from `@jest/globals` keeps that passing without adding
// `@types/jest` to the dependency tree.
import { describe, expect, it } from '@jest/globals';

import { FEE_GROUPS, groupFees } from './fee-units';

const fee = (unit: string, id = unit) => ({ id, unit });

function headingOf(unit: string): string | undefined {
  return groupFees([fee(unit)])[0]?.heading;
}

describe('groupFees', () => {
  it('puts the units an exhibitor books under the headings they book them by', () => {
    expect(headingOf('per_stall')).toBe('Stalls & bedding');
    expect(headingOf('per_bag')).toBe('Stalls & bedding');
  });

  it('keeps all three camping units under one heading', () => {
    // per_night, per_day and per_show are three ways a venue prices the same
    // spot, not three products. Splitting them files a $60-for-the-weekend
    // hook-up away from the nightly rate, where nobody looking for camping
    // finds it.
    for (const unit of ['per_night', 'per_day', 'per_show']) {
      expect(headingOf(unit)).toBe('Camping & hook-ups');
    }
  });

  it('separates what arrives automatically from what you order', () => {
    for (const unit of [
      'per_exhibitor',
      'per_horse',
      'per_judge_per_horse',
      'per_judge_per_exhibitor',
      'per_judge_per_entry',
    ]) {
      expect(headingOf(unit)).toBe('Added to every entry');
    }
  });

  it('files the units that bill nobody as published prices', () => {
    // `flat`, `per_entry`, `per_class_per_horse` and `percent_of_entry` are in
    // no billing family — see the `build_bill` Sharp Edge. Printing them beside
    // the automatic charges would read as a bill.
    for (const unit of ['flat', 'per_entry', 'per_class_per_horse', 'percent_of_entry']) {
      expect(headingOf(unit)).toBe('Other charges');
    }
  });

  it('does not lose a unit it has never heard of', () => {
    // A show publishes what it publishes. A fee that vanishes from the schedule
    // is worse than one under an imperfect heading, because somebody is still
    // going to be asked for it at the desk.
    expect(headingOf('per_fortnight_of_rain')).toBe('Other charges');
  });

  it('drops the groups a show has nothing in', () => {
    const groups = groupFees([fee('per_stall'), fee('per_bag')]);

    expect(groups).toHaveLength(1);
    expect(groups[0].fees).toHaveLength(2);
  });

  it('returns nothing at all for a show with no fees', () => {
    expect(groupFees([])).toEqual([]);
  });

  it('gives every group a note saying whether the amounts are the readers to control', () => {
    for (const group of FEE_GROUPS) {
      expect(group.note.length).toBeGreaterThan(0);
    }
  });
});
