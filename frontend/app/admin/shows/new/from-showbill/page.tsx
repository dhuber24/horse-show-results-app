import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import type { ShowBillImport } from '@/lib/showbill-import';
import { NO_FEATURES, fetchMyFeatures, type MyFeatures } from '@/lib/show-companies';
import PaidFeatureNotice from './PaidFeatureNotice';
import UploadClient from './UploadClient';

/**
 * Start a show from its printed show bill.
 *
 * The other door into `/admin/shows/new`: instead of typing Step 1 and then
 * building the schedule class by class, upload the bill the club already laid
 * out, check what the model read, and press Create. Nothing is created by the
 * upload — see `docs/showbill-import.md`.
 *
 * A paid feature (migration 142): a caller whose show company has not paid for
 * it is told so, and offered the ordinary setup, instead of an upload form.
 */
export default async function FromShowbillPage() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!role || !['ADMIN', 'SHOW_MANAGER', 'SHOW_SECRETARY'].includes(role)) {
    redirect('/admin');
  }

  const headers = await getAuthHeaders();
  let available = false;
  let enabled = false;
  let mine: MyFeatures = NO_FEATURES;
  let recent: ShowBillImport[] = [];
  if (headers) {
    const availRes = await fetch(`${API_URL}/show-bill-imports/availability`, { headers, cache: 'no-store' }).catch(
      () => null,
    );
    const availability = availRes?.ok ? await readJsonBody(availRes) : null;
    available = Boolean(availability?.available);
    enabled = Boolean(availability?.enabled);
    if (enabled) {
      const recentRes = await fetch(`${API_URL}/show-bill-imports/`, { headers, cache: 'no-store' }).catch(() => null);
      if (recentRes?.ok) recent = (await readJsonBody(recentRes)) ?? [];
    } else {
      mine = await fetchMyFeatures(headers);
    }
  }

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
          Start from your show bill
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Upload the show bill you sent to the printer. We&apos;ll read the dates, venue, judges,
          clubs, class schedule and fees off it, and you check every one before the show is created.
        </p>
      </div>

      {!enabled ? (
        <PaidFeatureNotice mine={mine} />
      ) : (
        <>
          {!available && (
            <div
              className="rounded-lg border p-4 text-sm space-y-2"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--foreground)' }}
            >
              <p>Reading show bills isn&apos;t set up on this server.</p>
              <p>
                <Link href="/admin/shows/new" className="underline" style={{ color: 'var(--primary)' }}>
                  Set the show up step by step instead →
                </Link>
              </p>
            </div>
          )}
          {/* The list stays either way: a read that finished before the key was
              removed can still be reviewed and created. */}
          <UploadClient recent={recent} canUpload={available} />
        </>
      )}
    </main>
  );
}
