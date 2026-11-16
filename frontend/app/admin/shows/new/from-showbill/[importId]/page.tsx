import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { fetchShowTypes, fetchVenues } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import type { DirectoryJudge, DirectoryVenue } from '@/lib/showbill-import';
import Breadcrumbs from '@/components/Breadcrumbs';
import { SHOWBILL_IMPORT, fetchMyFeatures, hasFeature } from '@/lib/show-companies';
import PaidFeatureNotice from '../PaidFeatureNotice';
import StartClient from './StartClient';

/**
 * A show bill's read, and the press that makes a show of it.
 *
 * The client polls the read itself, because it may still be running when
 * somebody lands here. Once it is in, the person confirms the show's name,
 * breed association and dates, finds each judge and the venue in the
 * directories (or adds them), looks over the two notes drafted from the bill,
 * and Create makes the show as a DRAFT, filled in as far as the bill allows.
 *
 * Gated like the upload (migration 142): a company whose feature was turned off
 * mid-read sees why rather than a page whose every call is refused.
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
            Create the show from its bill
          </h1>
        </div>
        <PaidFeatureNotice mine={myFeatures} />
      </main>
    );
  }

  const getJson = async <T,>(url: string, fallback: T): Promise<T> => {
    const res = await fetch(url, { headers: headers ?? {}, cache: 'no-store' }).catch(() => null);
    return res?.ok ? res.json() : fallback;
  };
  const [showTypes, judges, venues, associations] = await Promise.all([
    fetchShowTypes().catch(() => []),
    getJson<DirectoryJudge[]>(`${API_URL}/judges/`, []),
    fetchVenues().catch(() => [] as DirectoryVenue[]),
    getJson<{ id: string; code: string; name: string }[]>(`${API_URL}/associations/`, []),
  ]);

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs
          crumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Shows', href: '/admin/shows' },
            { label: 'New Show', href: '/admin/shows/new' },
            { label: 'From a show bill', href: '/admin/shows/new/from-showbill' },
            { label: 'Create' },
          ]}
        />
        <h1 className="text-2xl font-bold mt-2" style={{ color: 'var(--foreground)' }}>
          Create the show from its bill
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Nothing is created until you press Create. The show starts as a draft with everything the
          bill says filled in; what to look over is in its office notes.
        </p>
      </div>

      <StartClient
        importId={importId}
        showTypes={showTypes}
        judgeDirectory={judges}
        venueDirectory={venues}
        associations={associations}
        canAddVenue={role === 'ADMIN' || role === 'SHOW_MANAGER'}
      />
    </main>
  );
}
