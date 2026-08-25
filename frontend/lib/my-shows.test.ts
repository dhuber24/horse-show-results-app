import { describe, expect, it } from '@jest/globals';

import { formatDateRange, formatMoney, isPastShow, ordinal } from './my-shows';
import type { MyShow } from './my-shows';

describe('formatMoney', () => {
  it('renders whole and part dollars', () => {
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(2500)).toBe('$25.00');
    expect(formatMoney(123456)).toBe('$1,234.56');
  });

  it('renders a credit as negative rather than dropping the sign', () => {
    // An exhibitor who overpaid, or a refunded account. This is the one nobody
    // looks at, and a bill that renders a credit as a charge is worse than one
    // that fails to render.
    expect(formatMoney(-5000)).toBe('-$50.00');
  });
});

describe('ordinal', () => {
  it('suffixes the first three places', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
  });

  it('handles the teens, which do not follow their last digit', () => {
    // The classic ordinal bug: 11/12/13 take "th", not "st"/"nd"/"rd".
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(13)).toBe('13th');
  });

  it('picks the suffix back up in the twenties', () => {
    expect(ordinal(21)).toBe('21st');
    expect(ordinal(22)).toBe('22nd');
    expect(ordinal(23)).toBe('23rd');
    expect(ordinal(24)).toBe('24th');
  });

  it('handles hundreds, where the teens rule repeats', () => {
    expect(ordinal(100)).toBe('100th');
    expect(ordinal(101)).toBe('101st');
    expect(ordinal(111)).toBe('111th');
    expect(ordinal(121)).toBe('121st');
  });
});

describe('formatDateRange', () => {
  it('collapses a one-day show to a single date', () => {
    expect(formatDateRange('2026-06-01', '2026-06-01')).toBe('Jun 1, 2026');
  });

  it('shows only the closing day when a show stays in one month', () => {
    expect(formatDateRange('2026-06-01', '2026-06-03')).toBe('Jun 1–3, 2026');
  });

  it('spells out both months when a show crosses one', () => {
    expect(formatDateRange('2026-05-30', '2026-06-02')).toBe('May 30 – Jun 2, 2026');
  });
});

describe('isPastShow', () => {
  const show = (show_status: string) => ({ show_status }) as MyShow;

  it('keeps a show current while it can still be entered or shown in', () => {
    expect(isPastShow(show('PUBLISHED'))).toBe(false);
    expect(isPastShow(show('ACTIVE'))).toBe(false);
  });

  it('treats everything else as history', () => {
    expect(isPastShow(show('COMPLETED'))).toBe(true);
    expect(isPastShow(show('CANCELLED'))).toBe(true);
    expect(isPastShow(show('DRAFT'))).toBe(true);
  });
});
