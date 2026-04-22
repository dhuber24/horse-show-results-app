import Link from 'next/link';
import { auth } from '@/auth';
import { API_URL } from '@/lib/backend-fetch';

const statusStyle = (status: string) => {
  switch (status) {
    case 'ACTIVE': return 'bg-green-100 text-green-800';
    case 'PUBLISHED': return 'bg-amber-100 text-amber-800';
    case 'COMPLETED': return 'bg-blue-100 text-blue-800';
    default: return 'bg-gray-100 text-gray-600';
  }
};

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
        <Link href="/admin" className="text-sm hover:underline" style={{ color: '#8b4513' }}>
          ← Back to Admin
        </Link>
        <div className="flex items-center justify-between mt-2">
          <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>
            {role === 'SHOW_ADMIN' ? 'My Shows' : 'Shows'}
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

      {shows.length === 0 ? (
        <p style={{ color: '#8b7355' }}>
          {role === 'SHOW_ADMIN' ? 'No shows assigned to you yet.' : 'No shows yet.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {shows.map((show: any) => (
            <li key={show.id}>
              <Link
                href={`/admin/shows/${show.id}`}
                className="block p-4 rounded-lg border transition-colors hover:bg-amber-50"
                style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold" style={{ color: '#2c1810' }}>{show.name}</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusStyle(show.status)}`}>
                    {show.status}
                  </span>
                </div>
                <div className="text-sm mt-0.5" style={{ color: '#8b7355' }}>
                  {show.venue} · {show.start_date} – {show.end_date}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
