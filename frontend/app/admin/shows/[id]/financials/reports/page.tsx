import Link from 'next/link';
import { fetchShow } from '@/lib/api';
import { getAuthHeaders, API_URL, readJsonBody } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import { reportIcon, type ReportDefinition } from '@/lib/financials';

/**
 * The reporting module index.
 *
 * The list comes from the backend registry (`backend/financial_reports.py`), not
 * from a hardcoded array here — a report added there shows up on this page with
 * no frontend change, which is the point of the registry.
 */
async function loadReports(showId: string): Promise<ReportDefinition[] | null> {
  const headers = await getAuthHeaders();
  if (!headers) return null;
  const res = await fetch(`${API_URL}/shows/${showId}/financials/reports`, {
    headers,
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return readJsonBody(res);
}

export default async function FinancialReportsPage({
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
            { label: 'Financials', href: `/admin/shows/${id}/financials` },
            { label: 'Reports' },
          ]}
        />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>
          Reports
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          {show.name} — every report is built from the same figures as the Financials screen.
        </p>
      </div>

      {!reports ? (
        <div
          className="rounded border p-4 text-sm"
          style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }}
        >
          Couldn&rsquo;t load the report list. Reload the page, and if it keeps happening check
          that you&rsquo;re assigned to this show.
        </div>
      ) : reports.length === 0 ? (
        <p className="text-sm" style={{ color: '#8b7355' }}>
          No reports are available yet.
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {reports.map((report) => (
            <Link
              key={report.slug}
              href={`/admin/shows/${id}/financials/reports/${report.slug}`}
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
