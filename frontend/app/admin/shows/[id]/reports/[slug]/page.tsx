import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchShow } from '@/lib/api';
import { getAuthHeaders, API_URL, readJsonBody } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import { reportIcon, type Report } from '@/lib/reports';
import ReportActions from '@/components/ReportActions';
import ReportTable from '@/components/ReportTable';

/**
 * One show report, rendered generically — the same `ReportTable` the financials
 * reports use, because both registries return the same shape.
 */
async function loadReport(showId: string, slug: string): Promise<Report | null | 'missing'> {
  const headers = await getAuthHeaders();
  if (!headers) return null;
  const res = await fetch(`${API_URL}/shows/${showId}/reports/${slug}`, {
    headers,
    cache: 'no-store',
  });
  if (res.status === 404) return 'missing';
  if (!res.ok) return null;
  return readJsonBody(res);
}

export default async function ShowReportPage({
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
        { label: 'Show Record', href: `/admin/shows/${id}/reports` },
        { label: report ? report.title : 'Report' },
      ]}
    />
  );

  if (!report) {
    return (
      <main className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
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

  return (
    <main className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
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

      <div>
        <ReportTable report={report} />
      </div>

      <p className="text-sm">
        <Link
          href={`/admin/shows/${id}/reports`}
          className="underline"
          style={{ color: '#8b4513' }}
        >
          ← All reports
        </Link>
      </p>
    </main>
  );
}
