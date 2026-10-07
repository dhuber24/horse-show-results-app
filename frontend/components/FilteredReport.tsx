'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { describeReportFilters, filterReportRows, type Report } from '@/lib/reports';
import ReportActions from '@/components/ReportActions';
import ReportTable from '@/components/ReportTable';
import ResultsFilterBar from '@/components/ResultsFilterBar';

/**
 * A report with whatever filters its registry declares (`report.filters`), and
 * without any where it declares none — so it renders every show report, and a
 * filter added on the backend appears here with no frontend change.
 *
 * **The filters narrow what is on the page and nothing else.** The report is
 * fetched whole; CSV and Print take the rows on screen, because "print Ann
 * Reed's results" is the reason to filter one. A filtered copy says so — above
 * the table, on paper too, and in the CSV — so a part of the show's record is
 * never forwarded as the whole of it.
 */
export default function FilteredReport({
  report,
  showName,
  crumbs,
  heading,
  myClassIds,
}: {
  report: Report;
  showName: string;
  crumbs: ReactNode;
  /** The title and description, beside the actions. */
  heading: ReactNode;
  /** The reader's own classes at this show, for a signed-in exhibitor; null
   *  for anybody else, who is offered no *My classes* toggle. */
  myClassIds: string[] | null;
}) {
  const filters = report.filters ?? [];
  const typed = filters.filter((f) => f.match !== 'my_classes');
  const offersMine = filters.some((f) => f.match === 'my_classes') && myClassIds !== null;

  const [values, setValues] = useState<Record<string, string>>({});
  const [mineOnly, setMineOnly] = useState(false);
  const mine = useMemo(() => new Set(myClassIds ?? []), [myClassIds]);

  const rows = useMemo(
    () => filterReportRows(report, values, mineOnly ? mine : null),
    [report, values, mineOnly, mine],
  );
  const note = describeReportFilters(report, values, mineOnly);
  const shown: Report = note ? { ...report, rows } : report;

  return (
    <>
      <div>
        {crumbs}
        <div className="flex flex-wrap items-start justify-between gap-3 mt-2">
          {heading}
          <ReportActions report={shown} showName={showName} filterNote={note} />
        </div>
      </div>

      {filters.length > 0 && report.rows.length > 0 && (
        <div className="print:hidden max-w-3xl">
          <ResultsFilterBar
            idPrefix={`report-${report.slug}`}
            fields={typed.map((f) => ({
              key: f.key,
              label: f.label,
              numeric: f.match === 'exact',
            }))}
            values={values}
            onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
            // Every class they are in, posted or not: counting only the posted
            // ones would grey the toggle out as "not entered" for somebody
            // whose classes are simply still to be posted.
            mine={offersMine
              ? { on: mineOnly, count: mine.size, onToggle: () => setMineOnly((v) => !v) }
              : null}
            onClear={note ? () => { setValues({}); setMineOnly(false); } : null}
            summary={note ? `${rows.length} of ${report.rows.length} rows` : null}
          />
        </div>
      )}

      <div>
        {note && (
          <p className="text-sm mb-2" style={{ color: 'var(--text-deep)' }}>
            <span className="font-semibold">Filtered</span> — {note}. Showing {rows.length} of{' '}
            {report.rows.length} rows; clear the filters for the whole report.
          </p>
        )}
        {note && rows.length === 0 ? (
          <div
            className="rounded-lg border border-dashed p-6 text-center"
            style={{ borderColor: 'var(--border)' }}
          >
            <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
              No rows match these filters
            </p>
          </div>
        ) : (
          <ReportTable report={shown} />
        )}
      </div>
    </>
  );
}
