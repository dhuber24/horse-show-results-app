import Link from 'next/link';
import { auth } from '@/auth';
import { API_URL } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import VenueList from './VenueList';

async function fetchVenuesForUser(headers: Record<string, string>) {
  const res = await fetch(`${API_URL}/venues/`, { headers, cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

export default async function AdminVenuesPage() {
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

  const venues = await fetchVenuesForUser(headers);

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Venues' },
        ]} />
        <div className="flex items-center justify-between mt-2">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>
            Venues
          </h1>
          {(role === 'ADMIN' || role === 'SHOW_MANAGER') && (
            <Link
              href="/admin/venues/new"
              className="text-sm px-4 py-2 rounded font-medium"
              style={{ backgroundColor: 'var(--foreground)', color: 'var(--bg-subtle)' }}
            >
              + Add New Venue
            </Link>
          )}
        </div>
      </div>

      {venues.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>No venues yet.</p>
      ) : role === 'ADMIN' || role === 'SHOW_MANAGER' ? (
        <VenueList initialVenues={venues} currentUserId={user?.id} role={role} />
      ) : (
        <ul className="space-y-3">
          {(venues as any[]).map((venue: any) => (
            <li key={venue.id}>
              <Link
                href={`/admin/venues/${venue.id}`}
                className="block p-4 rounded-lg border transition-colors hover:bg-amber-50"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
              >
                <div className="font-semibold" style={{ color: 'var(--foreground)' }}>{venue.name}</div>
                <div className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
                  {[venue.address, venue.city, venue.state].filter(Boolean).join(', ') || 'No address'}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
