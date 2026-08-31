import Link from 'next/link';
import { fetchShow } from '@/lib/api';
import { getAuthHeaders, API_URL, readJsonBody } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import ReportTable from '@/components/ReportTable';
import PrintButton from '@/components/PrintButton';
import { type Report } from '@/lib/reports';

/**
 * The one-year retention bundle.
 *
 * SC-110.J: *"Management must retain copies of the original signed judge's
 * placing cards, the show results and the entry cards for at least one year."*
 * The app held all three ingredients in some form and offered no way to get them
 * out together.
 *
 * **Generated, never uploaded** — the same reasoning as the show bill. An
 * uploaded archive is a second source of truth that goes stale the moment a
 * placing is corrected, and worse than none because people trust the copy they
 * printed. Re-running this after a correction gives the corrected record, and
 * the office prints or exports a copy at the point it needs to keep one.
 *
 * The caveats are on the page rather than in a doc, because the person printing
 * it is the person who needs to know the signed cards are still paper.
 */
interface Bundle {
  show_name: string;
  show_type_code: string | null;
  apha_show_number: string | null;
  start_date: string;
  end_date: string;
  generated_at: string;
  caveats: string[];
  reports: Report[];
}

async function loadBundle(showId: string): Promise<Bundle | null> {
  const headers = await getAuthHeaders();
  if (!headers) return null;
  const res = await fetch(`${API_URL}/shows/${showId}/reports/archive`, {
    headers,
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return readJsonBody(res);
}

function formatRange(start: string, end: string): string {
  const opts = { month: 'short', day: 'numeric', year: 'numeric' } as const;
  const from = new Date(`${start}T00:00:00`).toLocaleDateString('en-US', opts);
  if (start === end) return from;
  return `${from} – ${new Date(`${end}T00:00:00`).toLocaleDateString('en-US', opts)}`;
}

export default async function RetentionArchivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [show, bundle] = await Promise.all([fetchShow(id), loadBundle(id)]);

  const crumbs = (
    <Breadcrumbs
      crumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Shows', href: '/admin/shows' },
        { label: show.name, href: `/admin/shows/${id}` },
        { label: 'Show Record', href: `/admin/shows/${id}/reports` },
        { label: 'Retention Bundle' },
      ]}
    />
  );

  if (!bundle) {
    return (
      <main className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        <div>{crumbs}</div>
        <div
          className="rounded border p-4 text-sm"
          style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }}
        >
          Couldn&rsquo;t build the bundle. Reload the page, and if it keeps happening check that
          you&rsquo;re assigned to this show.
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-6xl mx-auto p-4 md:p-6 space-y-8">
      <div className="print:hidden">{crumbs}</div>

      <header className="space-y-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>
              {bundle.show_name}
            </h1>
            <p className="text-sm" style={{ color: '#8b7355' }}>
              {formatRange(bundle.start_date, bundle.end_date)}
              {bundle.show_type_code && ` · ${bundle.show_type_code}`}
              {bundle.apha_show_number && ` · Show #${bundle.apha_show_number}`}
            </p>
            <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
              Show record for retention · generated{' '}
              {new Date(bundle.generated_at).toLocaleString('en-US')}
            </p>
          </div>
          <div className="print:hidden">
            <PrintButton label="🖨 Print bundle" />
          </div>
        </div>
      </header>

      <section
        className="rounded border px-4 py-3 text-sm space-y-1.5"
        style={{ backgroundColor: '#fdf8eb', borderColor: '#d4b896', color: '#5c3d1e' }}
      >
        <p className="font-semibold">Before you file this</p>
        {bundle.caveats.map((caveat, index) => (
          <p key={index}>· {caveat}</p>
        ))}
      </section>

      {bundle.reports.map((report) => (
        <section key={report.slug} className="space-y-2 break-before-page">
          <h2 className="text-lg font-bold" style={{ color: '#2c1810' }}>
            {report.title}
          </h2>
          <p className="text-sm" style={{ color: '#8b7355' }}>
            {report.description}
          </p>
          <ReportTable report={report} />
        </section>
      ))}

      <p className="text-sm print:hidden">
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
