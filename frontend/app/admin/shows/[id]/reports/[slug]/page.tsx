import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { fetchShow } from '@/lib/api';
import { getAuthHeaders, API_URL, readJsonBody } from '@/lib/backend-fetch';
import { canActAsExhibitor } from '@/lib/exhibitor-access';
import { fetchRegisteredClassIds } from '@/lib/my-class-ids';
import Breadcrumbs from '@/components/Breadcrumbs';
import { reportIcon, type Report } from '@/lib/reports';
import FilteredReport from '@/components/FilteredReport';

/**
 * One show report, rendered generically — the same `ReportTable` the financials
 * reports use, because both registries return the same shape — with the
 * filters the registry declares for it (Show Results has Name, Back #, Horse,
 * Class and *My classes*).
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
          style={{ backgroundColor: 'var(--error-bg)', borderColor: 'var(--error-border)', color: 'var(--error-strong)' }}
        >
          Couldn&rsquo;t run that report. Reload the page, and if it keeps happening check that
          you&rsquo;re assigned to this show.
        </div>
      </main>
    );
  }

  // Somebody in the office who also shows (an exhibitor record on the same
  // account) gets *My classes*; asked only of a report that offers it.
  const offersMine = (report.filters ?? []).some((f) => f.match === 'my_classes');
  const session = offersMine ? await auth() : null;
  const myClassIds = session && (await canActAsExhibitor())
    ? await fetchRegisteredClassIds(id, (session.user as { id: string }).id)
    : null;

  return (
    <main className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      <FilteredReport
        report={report}
        showName={show.name}
        crumbs={crumbs}
        myClassIds={myClassIds}
        heading={
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--foreground)' }}>
              <span aria-hidden>{reportIcon(report.slug)}</span>
              {report.title}
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
              {report.description}
            </p>
          </div>
        }
      />

      <p className="text-sm">
        <Link
          href={`/admin/shows/${id}/reports`}
          className="underline"
          style={{ color: 'var(--accent)' }}
        >
          ← All reports
        </Link>
      </p>
    </main>
  );
}
