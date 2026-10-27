import { fetchShow } from '@/lib/api';
import { getAuthHeaders } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import ProLockedPanel from '@/components/ProLockedPanel';
import { DATA_EXPORT, fetchMyFeatures, fetchShowPlan, showHasFeature } from '@/lib/show-companies';
import DataExportBuilder from './DataExportBuilder';

/**
 * The show's results as data, in the columns the office picks.
 *
 * Beside the association reports rather than instead of them: those are laid
 * out the way a breed body asks, and stay that way. This is the file a club or
 * a show company takes away to work out its own standings and awards — the
 * rules are theirs, and GaitDesk applies none of them (`backend/data_export.py`).
 *
 * GaitDesk Pro, on the show's plan. The endpoint refuses a Basic show itself
 * (`require_show_feature`); this only decides what the page offers.
 */
export default async function DataExportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const headers = await getAuthHeaders();
  const [show, plan] = await Promise.all([fetchShow(id), fetchShowPlan(id, headers)]);
  const unlocked = showHasFeature(plan, DATA_EXPORT);
  const mine = unlocked ? null : await fetchMyFeatures(headers);

  return (
    <main className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs
          crumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Shows', href: '/admin/shows' },
            { label: show.name, href: `/admin/shows/${id}` },
            { label: 'Show Record', href: `/admin/shows/${id}/reports` },
            { label: 'Data Export' },
          ]}
        />
        <h1 className="text-2xl font-bold mt-2 flex items-center gap-2" style={{ color: 'var(--foreground)' }}>
          <span aria-hidden>📤</span>
          Data Export
        </h1>
        <p className="text-sm mt-1 max-w-3xl" style={{ color: 'var(--muted)' }}>
          Every placing or entry at {show.name}, with the membership and registration numbers on
          file, in the columns you pick. Take it into a spreadsheet for circuit standings, year-end
          awards or your club&rsquo;s own records. The association reports are unchanged.
        </p>
      </div>

      {mine ? (
        <div className="max-w-3xl">
          <ProLockedPanel
            feature={DATA_EXPORT}
            plan={plan}
            mine={mine}
            backHref={`/admin/shows/${id}/reports`}
            backLabel="Back to Show Record"
          />
        </div>
      ) : (
        <DataExportBuilder showId={id} showName={show.name} />
      )}
    </main>
  );
}
