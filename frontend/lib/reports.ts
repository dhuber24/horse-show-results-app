/**
 * A report is data, not a page.
 *
 * Two backend registries now produce them — `financial_reports.py` (money) and
 * `show_reports.py` (what the office sends the association) — and both return
 * the same shape: a slug, a title, a column list, rows of cells, optional
 * totals, and notes. One renderer draws all of them, so adding a report is a
 * function on the backend and nothing here.
 *
 * These types and helpers live apart from `lib/financials.ts` because they are
 * not about money; that module re-exports them so existing imports keep working.
 */

export type ReportColumn = {
  key: string;
  label: string;
  align: 'left' | 'right';
  is_money: boolean;
};

export type ReportDefinition = {
  slug: string;
  title: string;
  description: string;
};

export type Report = {
  slug: string;
  title: string;
  description: string;
  show_id: string;
  show_name: string;
  generated_at: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  totals: Record<string, string | number | null>;
  notes: string[];
};

/** Emoji per report, keyed by slug. Kept on the frontend because it is
 *  presentation — a report added to a backend registry still renders, it just
 *  gets the fallback icon until someone picks one for it. */
export const REPORT_ICONS: Record<string, string> = {
  // Financials
  'revenue-summary': '📊',
  'outstanding-balances': '🧾',
  registrations: '📋',
  'payments-received': '💵',
  'fees-sold': '🏕️',
  'side-pot-money': '💰',
  // What the office sends the association
  results: '🏆',
  'class-summary': '📅',
  'entry-cards': '📝',
  'judge-cards': '⚖️',
  compliance: '✅',
  attestations: '✍️',
};

export function reportIcon(slug: string): string {
  return REPORT_ICONS[slug] ?? '📄';
}

/** A cell as text. Money columns arrive as integer cents and are formatted
 *  here so every report renders currency identically. */
export function formatReportCell(
  value: string | number | null | undefined,
  column: ReportColumn,
): string {
  if (value === null || value === undefined || value === '') return '—';
  if (column.is_money && typeof value === 'number') {
    return (value / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }
  return String(value);
}
