import Link from 'next/link';
import { auth } from '@/auth';
import { API_URL } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import AutomateShowCard from '@/components/AutomateShowCard';
import { fetchMyFeatures } from '@/lib/show-companies';
import ShowList from './ShowList';

async function fetchShowsForUser(headers: Record<string, string>) {
  const res = await fetch(`${API_URL}/shows/`, { headers, cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
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
            <Link
              href="/admin/shows/new"
              className="text-sm px-4 py-2 rounded font-medium"
              style={{ backgroundColor: 'var(--foreground)', color: 'var(--bg-subtle)' }}
            >
              + Create New Show
            </Link>
          </div>
        </div>
      </div>

      {/* Where a show starts, so where the faster way to start one is sold.
          Only to the roles that can create a show -- every role this page
          admits, today, but the check keeps it honest if that widens. */}
      {['ADMIN', 'SHOW_MANAGER', 'SHOW_SECRETARY'].includes(role) && <AutomateShowCard mine={myFeatures} />}

      <ShowList initialShows={shows} role={role ?? ''} />
    </main>
  );
}
