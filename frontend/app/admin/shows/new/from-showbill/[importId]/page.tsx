import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { fetchAssociations, fetchShowTypes, fetchVenues } from '@/lib/api';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import type { Association, RegistryJudge } from '@/lib/showbill-import';
import { SHOWBILL_IMPORT, fetchMyFeatures, hasFeature } from '@/lib/show-companies';
import PaidFeatureNotice from '../PaidFeatureNotice';
import ReviewClient from './ReviewClient';

/**
 * Review a show read off its show bill, then create it.
 *
 * The page loads the lookups the review matches against — show types, venues,
 * the association registry, the judge registry — and the client polls the read
 * itself, because it may still be running when somebody lands here.
 *
 * Gated like the upload (migration 142): a company whose feature was turned off
 * mid-review sees why rather than a review screen whose every call is refused.
 */
export default async function ReviewShowbillPage({
  params,
}: {
  params: Promise<{ importId: string }>;
}) {
  const { importId } = await params;
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!role || !['ADMIN', 'SHOW_MANAGER', 'SHOW_SECRETARY'].includes(role)) {
    redirect('/admin');
  }

  const headers = await getAuthHeaders();
  const myFeatures = await fetchMyFeatures(headers);
  if (!hasFeature(myFeatures, SHOWBILL_IMPORT)) {
    return (
      <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
        <div>
          <Breadcrumbs
            crumbs={[
              { label: 'Admin', href: '/admin' },
              { label: 'Shows', href: '/admin/shows' },
              { label: 'New Show', href: '/admin/shows/new' },
              { label: 'From a show bill' },
            ]}
          />
          <h1 className="text-2xl font-bold mt-2" style={{ color: 'var(--foreground)' }}>
            Check what was read
          </h1>
        </div>
        <PaidFeatureNotice mine={myFeatures} />
      </main>
    );
  }

  const [showTypes, venues, associations, judges] = await Promise.all([
    fetchShowTypes().catch(() => []),
    fetchVenues().catch(() => []),
    fetchAssociations(headers ?? undefined).catch(() => []) as Promise<Association[]>,
    headers
      ? fetch(`${API_URL}/judges/`, { headers, cache: 'no-store' })
          .then(async (res) => (res.ok ? ((await readJsonBody(res)) as RegistryJudge[]) : []))
          .catch(() => [] as RegistryJudge[])
      : Promise.resolve([] as RegistryJudge[]),
  ]);

  return (
    <main className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs
          crumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Shows', href: '/admin/shows' },
            { label: 'New Show', href: '/admin/shows/new' },
            { label: 'From a show bill', href: '/admin/shows/new/from-showbill' },
            { label: 'Review' },
          ]}
        />
        <h1 className="text-2xl font-bold mt-2" style={{ color: 'var(--foreground)' }}>
          Check what was read
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Nothing is created until you press Create. The show starts as a draft, so you can keep
          working on it in the setup steps afterwards.
        </p>
      </div>

      <ReviewClient
        importId={importId}
        callerRole={role}
        showTypes={showTypes}
        venues={venues}
        associations={associations}
        registryJudges={judges}
      />
    </main>
  );
}
