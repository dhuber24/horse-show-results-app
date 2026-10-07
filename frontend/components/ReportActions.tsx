'use client';

import { type Report } from '@/lib/reports';

/**
 * Download and print for a report, shared by both report registries.
 *
 * Lived under the financials report route until `show_reports.py` started
 * producing the same shape; a second copy would have been the drift the
 * registry pattern exists to avoid.
 *
 * The CSV is built from the report already on the page rather than fetched
 * again, so the file and the table can never be two different snapshots. Money
 * is written as plain decimal dollars — no currency symbol or thousands
 * separator — because this file is opened in a spreadsheet, where "$1,240.00"
 * arrives as text and will not sum.
 */
function toCsv(report: Report, filterNote: string | null = null): string {
  const escape = (value: string) =>
    /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const cell = (raw: string | number | null | undefined, isMoney: boolean): string => {
    if (raw === null || raw === undefined) return '';
    if (isMoney && typeof raw === 'number') return (raw / 100).toFixed(2);
    return String(raw);
  };

  const lines: string[] = [];
  lines.push(escape(`${report.show_name} — ${report.title}`));
  lines.push(escape(`Generated ${new Date(report.generated_at).toLocaleString('en-US')}`));
  // A filtered file is part of the record; it says so, so it is never sent on
  // as the whole of it.
  if (filterNote) lines.push(escape(`Filtered: ${filterNote}`));
  lines.push('');
  lines.push(report.columns.map((c) => escape(c.label)).join(','));

  for (const row of report.rows) {
    lines.push(
      report.columns.map((c) => escape(cell(row[c.key], c.is_money))).join(','),
    );
  }

  if (Object.keys(report.totals).length > 0) {
    lines.push(
      report.columns.map((c) => escape(cell(report.totals[c.key], c.is_money))).join(','),
    );
  }

  if (report.notes.length > 0) {
    lines.push('');
    for (const note of report.notes) lines.push(escape(note));
  }

  return lines.join('\r\n');
}

export default function ReportActions({
  report,
  showName,
  filterNote = null,
}: {
  /** The rows on the page — already filtered, where the page filters. */
  report: Report;
  showName: string;
  /** The filters in use, in words (`describeReportFilters`); null for none. */
  filterNote?: string | null;
}) {
  const download = () => {
    const blob = new Blob([toCsv(report, filterNote)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeShow = showName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    link.href = url;
    link.download = `${safeShow || 'show'}-${report.slug}${filterNote ? '-filtered' : ''}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const rowCount = report.rows.length;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={download}
        disabled={rowCount === 0}
        className="px-3 py-2 rounded text-sm font-medium border disabled:opacity-50"
        style={{ borderColor: 'var(--border)', color: 'var(--accent)', backgroundColor: 'var(--surface)' }}
        title={rowCount === 0
          ? (filterNote ? 'No rows match the filters' : 'Nothing to export yet')
          : filterNote ? 'Download the filtered rows as CSV' : 'Download as CSV'}
      >
        ⬇ CSV
      </button>
      <button
        onClick={() => window.print()}
        disabled={rowCount === 0}
        className="px-3 py-2 rounded text-sm font-medium border disabled:opacity-50"
        style={{ borderColor: 'var(--border)', color: 'var(--accent)', backgroundColor: 'var(--surface)' }}
        title={rowCount === 0
          ? (filterNote ? 'No rows match the filters' : 'Nothing to print yet')
          : filterNote ? 'Print the filtered rows' : 'Print this report'}
      >
        🖨 Print
      </button>
    </div>
  );
}

export { toCsv };
