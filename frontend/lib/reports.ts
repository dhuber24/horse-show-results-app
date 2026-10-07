import { matchesWhole, matchesWords } from './results-filter';

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

/**
 * A way to narrow a report on the page, declared by the backend beside the
 * columns it reads (`show_reports._filter`). `columns` may name a row key that
 * is not a column — the results rows carry `class_id` for *My classes*.
 */
export type ReportFilter = {
  key: string;
  label: string;
  columns: string[];
  /** `words` and `exact` are typed fields; `my_classes` is a toggle. */
  match: 'words' | 'exact' | 'my_classes';
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
  /** Absent or empty where the page offers no filter (every financial report). */
  filters?: ReportFilter[];
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

/**
 * The rows that pass every filter in use. `values` holds what is typed, by
 * filter key; `myClassIds` is the reader's own classes with *My classes* on,
 * and null with it off. Matching is `lib/results-filter.ts`, the same the
 * public Results page uses.
 */
export function filterReportRows(
  report: Report,
  values: Record<string, string>,
  myClassIds: ReadonlySet<string> | null,
): Report['rows'] {
  const filters = report.filters ?? [];
  return report.rows.filter((row) =>
    filters.every((f) => {
      if (f.match === 'my_classes') {
        return myClassIds === null || myClassIds.has(String(row[f.columns[0]] ?? ''));
      }
      const typed = values[f.key] ?? '';
      if (f.match === 'exact') return f.columns.some((c) => matchesWhole(typed, row[c]));
      return matchesWords(typed, ...f.columns.map((c) => row[c]));
    }),
  );
}

/**
 * The filters in use, in words — "Name “reed” · My classes" — or null when
 * none is. Printed above a filtered table and written into its CSV, so a part
 * of the show's record is never mistaken for the whole of it.
 */
export function describeReportFilters(
  report: Report,
  values: Record<string, string>,
  myClasses: boolean,
): string | null {
  const parts = (report.filters ?? []).flatMap((f) => {
    if (f.match === 'my_classes') return myClasses ? [f.label] : [];
    const typed = (values[f.key] ?? '').trim();
    return typed ? [`${f.label} “${typed}”`] : [];
  });
  return parts.length > 0 ? parts.join(' · ') : null;
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
