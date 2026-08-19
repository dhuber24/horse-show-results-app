import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchShow } from '@/lib/api';
import { getAuthHeaders, API_URL, readJsonBody } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import { formatReportCell, reportIcon, type Report } from '@/lib/financials';
import ReportActions from './ReportActions';

/**
 * One report, rendered generically.
 *
 * There is no per-report component: the backend sends columns and rows, and this
 * page draws whatever it is given. A report added to
 * `backend/financial_reports.py` is reachable here immediately.
 */
async function loadReport(showId: string, slug: string): Promise<Report | null | 'missing'> {
  const headers = await getAuthHeaders();
  if (!headers) return null;
  const res = await fetch(`${API_URL}/shows/${showId}/financials/reports/${slug}`, {
    headers,
    cache: 'no-store',
  });
  if (res.status === 404) return 'missing';
  if (!res.ok) return null;
  return readJsonBody(res);
}

export default async function FinancialReportPage({
  params,
}: {
  params: Promise<{ id: string; slug: string }>;
}) {
  const { id, slug } = await params;
  const [show, report] = await Promise.all([fetchShow(id), loadReport(id, slug)]);

  if (report === 'missing') notFound();

  const crumbs = (
    <Breadcrumbs
      crumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Shows', href: '/admin/shows' },
        { label: show.name, href: `/admin/shows/${id}` },
        { label: 'Financials', href: `/admin/shows/${id}/financials` },
        { label: 'Reports', href: `/admin/shows/${id}/financials/reports` },
        { label: report ? report.title : 'Report' },
      ]}
    />
  );

  if (!report) {
    return (
      <main className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
        <div>{crumbs}</div>
        <div
          className="rounded border p-4 text-sm"
          style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }}
        >
          Couldn&rsquo;t run that report. Reload the page, and if it keeps happening check that
          you&rsquo;re assigned to this show.
        </div>
      </main>
    );
  }

  const hasTotals = Object.keys(report.totals).length > 0;

  return (
    <main className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        {crumbs}
        <div className="flex flex-wrap items-start justify-between gap-3 mt-2">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: '#2c1810' }}>
              <span aria-hidden>{reportIcon(report.slug)}</span>
              {report.title}
            </h1>
            <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
              {report.description}
            </p>
          </div>
          <ReportActions report={report} showName={show.name} />
        </div>
      </div>

      {report.rows.length === 0 ? (
        <div
          className="rounded-lg border border-dashed p-6 text-center"
          style={{ borderColor: '#d4b896' }}
        >
          <p className="text-sm font-medium" style={{ color: '#2c1810' }}>
            Nothing to report yet
          </p>
          {report.notes.length > 0 && (
            <p className="text-xs mt-1" style={{ color: '#8b7355' }}>
              {report.notes[0]}
            </p>
          )}
        </div>
      ) : (
        // Wide reports scroll inside their own container rather than pushing the
        // page sideways.
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: '#d4b896' }}>
          <table className="w-full text-sm" style={{ backgroundColor: '#ffffff' }}>
            <thead>
              <tr style={{ backgroundColor: '#faf7f2' }}>
                {report.columns.map((column) => (
                  <th
                    key={column.key}
                    className={`px-3 py-2 font-semibold whitespace-nowrap ${
                      column.align === 'right' ? 'text-right' : 'text-left'
                    }`}
                    style={{ color: '#5d4a37' }}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: '#f0e4d0' }}>
              {report.rows.map((row, index) => (
                <tr key={index}>
                  {report.columns.map((column) => (
                    <td
                      key={column.key}
                      className={`px-3 py-2 ${column.align === 'right' ? 'text-right' : 'text-left'} ${
                        column.is_money ? 'tabular-nums' : ''
                      }`}
                      style={{ color: column.is_money ? '#2c1810' : '#5d4a37' }}
                    >
                      {formatReportCell(row[column.key], column)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {hasTotals && (
              <tfoot>
                <tr style={{ backgroundColor: '#faf7f2' }}>
                  {report.columns.map((column) => (
                    <th
                      key={column.key}
                      className={`px-3 py-2.5 font-semibold ${
                        column.align === 'right' ? 'text-right' : 'text-left'
                      } ${column.is_money ? 'tabular-nums' : ''}`}
                      style={{ color: '#2c1810' }}
                    >
                      {report.totals[column.key] === undefined
                        ? ''
                        : formatReportCell(report.totals[column.key], column)}
                    </th>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {report.notes.length > 0 && report.rows.length > 0 && (
        <div
          className="rounded border px-4 py-3 text-sm space-y-1.5"
          style={{ backgroundColor: '#faf7f2', borderColor: '#d4b896', color: '#5d4a37' }}
        >
          {report.notes.map((note, index) => (
            <p key={index}>{note}</p>
          ))}
        </div>
      )}

      <p className="text-sm">
        <Link
          href={`/admin/shows/${id}/financials/reports`}
          className="underline"
          style={{ color: '#8b4513' }}
        >
          ← All reports
        </Link>
      </p>
    </main>
  );
}
