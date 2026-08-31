import Link from 'next/link';
import { fetchShow } from '@/lib/api';
import { getAuthHeaders, API_URL, readJsonBody } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import { reportIcon, type ReportDefinition } from '@/lib/reports';

/**
 * The record of the show, for the office to send on.
 *
 * The list comes from the backend registry (`backend/show_reports.py`), not from
 * an array here — a report added there appears with no frontend change, which is
 * the whole point of the registry. Same arrangement Financials uses; these are
 * the reports that are not about money.
 */
async function loadReports(showId: string): Promise<ReportDefinition[] | null> {
  const headers = await getAuthHeaders();
  if (!headers) return null;
  const res = await fetch(`${API_URL}/shows/${showId}/reports`, {
    headers,
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return readJsonBody(res);
}

export default async function ShowReportsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [show, reports] = await Promise.all([fetchShow(id), loadReports(id)]);

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs
          crumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Shows', href: '/admin/shows' },
            { label: show.name, href: `/admin/shows/${id}` },
            { label: 'Show Record' },
          ]}
        />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>
          Show Record
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          {show.name} — what ran, what was placed, what was entered, and what is
          outstanding on paper. Every report is generated from the show&rsquo;s own
          data, so re-running one after a correction gives the corrected record.
        </p>
      </div>

      <Link
        href={`/admin/shows/${id}/reports/archive`}
        className="block p-5 rounded-lg border transition-colors hover:bg-amber-50"
        style={{ borderColor: '#8b4513', backgroundColor: '#fdf8eb' }}
      >
        <div className="flex items-start gap-3">
          <div className="text-2xl" aria-hidden>
            🗄️
          </div>
          <div>
            <h2 className="font-semibold" style={{ color: '#2c1810' }}>
              Retention Bundle
            </h2>
            <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
              The set APHA asks management to keep for a year (SC-110.J), on one
              printable page. Read the caveats on it — the <em>signed</em> judge&rsquo;s
              cards are paper, and nothing here is that document.
            </p>
          </div>
        </div>
      </Link>

      {!reports ? (
        <div
          className="rounded border p-4 text-sm"
          style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }}
        >
          Couldn&rsquo;t load the report list. Reload the page, and if it keeps happening check
          that you&rsquo;re assigned to this show.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {reports.map((report) => (
            <Link
              key={report.slug}
              href={`/admin/shows/${id}/reports/${report.slug}`}
              className="block p-5 rounded-lg border transition-colors hover:bg-amber-50"
              style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
            >
              <div className="flex items-start gap-3">
                <div className="text-2xl" aria-hidden>
                  {reportIcon(report.slug)}
                </div>
                <div>
                  <h2 className="font-semibold" style={{ color: '#2c1810' }}>
                    {report.title}
                  </h2>
                  <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
                    {report.description}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
