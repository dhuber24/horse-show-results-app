import Link from 'next/link';
import { auth } from '@/auth';
import { API_URL } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
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

  const shows = await fetchShowsForUser(headers);

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: role === 'SHOW_SECRETARY' ? 'My Shows' : 'Shows' },
        ]} />
        <div className="flex items-center justify-between mt-2">
          <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>
            {role === 'SHOW_SECRETARY' ? 'My Shows' : 'Shows'}
          </h1>
          <div className="flex items-center gap-2">
            {role === 'ADMIN' && (
              <Link
                href="/admin/shows/types"
                className="text-sm px-4 py-2 rounded font-medium border"
                style={{ borderColor: '#d4b896', color: '#2c1810' }}
              >
                Manage Show Types
              </Link>
            )}
            <Link
              href="/admin/shows/new"
              className="text-sm px-4 py-2 rounded font-medium"
              style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
            >
              + Create New Show
            </Link>
          </div>
        </div>
      </div>

      <ShowList initialShows={shows} role={role ?? ''} />
    </main>
  );
}
