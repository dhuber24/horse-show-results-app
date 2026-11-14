import Link from 'next/link';
import { auth } from '@/auth';
import { API_URL } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import { SHOWBILL_IMPORT, fetchMyFeatures, hasFeature } from '@/lib/show-companies';
import type { ShowBillImport } from '@/lib/showbill-import';
import ShowList from './ShowList';
import ShowbillReads from './ShowbillReads';

async function fetchShowsForUser(headers: Record<string, string>) {
  const res = await fetch(`${API_URL}/shows/`, { headers, cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

/** The caller's recent show bill reads -- only asked for when their company has
 * the feature, since the endpoint refuses everybody else. */
async function fetchShowbillReads(headers: Record<string, string>): Promise<ShowBillImport[]> {
  const res = await fetch(`${API_URL}/show-bill-imports/`, { headers, cache: 'no-store' }).catch(() => null);
  if (!res?.ok) return [];
  return res.json().catch(() => []);
}

export default async function AdminShowsPage() {
  const session = await auth();
  const user = session?.user as any;
  const role = user?.role;
  const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': INTERNAL_API_KEY,
    'X-User-Id': user?.id ?? '',
    'X-User-Role': role ?? '',
  };

  const [shows, myFeatures] = await Promise.all([fetchShowsForUser(headers), fetchMyFeatures(headers)]);
  const showbillReads = hasFeature(myFeatures, SHOWBILL_IMPORT) ? await fetchShowbillReads(headers) : [];

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: role === 'SHOW_SECRETARY' ? 'My Shows' : 'Shows' },
        ]} />
        <div className="flex items-center justify-between mt-2">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>
            {role === 'SHOW_SECRETARY' ? 'My Shows' : 'Shows'}
          </h1>
          <div className="flex items-center gap-2">
            {role === 'ADMIN' && (
              <Link
                href="/admin/shows/types"
                className="text-sm px-4 py-2 rounded font-medium border"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
              >
                Manage Show Types
              </Link>
            )}
            {/* On GaitDesk Free (migration 169) the button still leads there --
                the New Show page is where the plan is chosen. */}
            <Link
              href="/admin/shows/new"
              className="text-sm px-4 py-2 rounded font-medium"
              style={{ backgroundColor: 'var(--foreground)', color: 'var(--bg-subtle)' }}
              title={
                role !== 'ADMIN' && !myFeatures.can_set_up_shows
                  ? 'Choose GaitDesk Basic or Pro first — nothing is charged until after the show'
                  : undefined
              }
            >
              {role !== 'ADMIN' && !myFeatures.can_set_up_shows ? '+ Choose a plan to create a show' : '+ Create New Show'}
            </Link>
          </div>
        </div>
      </div>

      <ShowbillReads initial={showbillReads} />

      <ShowList initialShows={shows} role={role ?? ''} />
    </main>
  );
}
