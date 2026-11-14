import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { fetchShowTypes } from '@/lib/api';
import { getAuthHeaders } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import { SHOWBILL_IMPORT, fetchMyFeatures, hasFeature } from '@/lib/show-companies';
import PaidFeatureNotice from '../PaidFeatureNotice';
import StartClient from './StartClient';

/**
 * A show bill's read, and the press that makes a show of it (migration 187).
 *
 * The client polls the read itself, because it may still be running when
 * somebody lands here. Once it is in, the person confirms the show's name,
 * breed association and dates, and Create makes the show as a DRAFT with every
 * doubt about the read a check on its setup step.
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

  const showTypes = await fetchShowTypes().catch(() => []);

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
          Nothing is created until you press Create. The show starts as a draft, and you check the
          rest of what was read step by step in setup.
        </p>
      </div>

      <StartClient importId={importId} showTypes={showTypes} />
    </main>
  );
}
