import { describe, expect, it } from '@jest/globals';

import { formatReceivedOn, formatReportCell, reportIcon } from './financials';
import type { ReportColumn } from './financials';

const money: ReportColumn = { key: 'total', label: 'Total', align: 'right', is_money: true };
const plain: ReportColumn = { key: 'count', label: 'Count', align: 'right', is_money: false };

describe('formatReportCell', () => {
  it('formats integer cents as currency in a money column', () => {
    expect(formatReportCell(1234, money)).toBe('$12.34');
    expect(formatReportCell(123456, money)).toBe('$1,234.56');
  });

  it('renders zero as zero money, not as a dash', () => {
    // The source tests `value === ''`, not falsiness. Anyone "simplifying"
    // that to `if (!value)` turns every zero on a financial report into an
    // em dash — a report of $0 collected would read as no data at all.
    expect(formatReportCell(0, money)).toBe('$0.00');
    expect(formatReportCell(0, plain)).toBe('0');
  });

  it('leaves a non-money numeric column unformatted', () => {
    expect(formatReportCell(42, plain)).toBe('42');
  });

  it('passes a string through even in a money column', () => {
    // Guarded on `typeof value === 'number'`, so a backend that sends a
    // pre-formatted string is rendered rather than divided by 100.
    expect(formatReportCell('n/a', money)).toBe('n/a');
  });

  it('shows a dash for a genuinely absent value', () => {
    expect(formatReportCell(null, money)).toBe('—');
    expect(formatReportCell(undefined, money)).toBe('—');
    expect(formatReportCell('', money)).toBe('—');
  });
});

describe('formatReceivedOn', () => {
  it('renders an ISO date as a readable day', () => {
    expect(formatReceivedOn('2026-06-01')).toBe('Jun 1, 2026');
    expect(formatReceivedOn('2026-12-25')).toBe('Dec 25, 2026');
  });
});

describe('reportIcon', () => {
  it('returns the icon picked for a known report', () => {
    expect(reportIcon('revenue-summary')).toBe('📊');
  });

  it('falls back for a report the backend added but nobody picked an icon for', () => {
    expect(reportIcon('a-report-added-later')).toBe('📄');
  });
});
