import Link from 'next/link';
import { fetchVenues } from '@/lib/api';

export default async function AdminVenuesPage() {
  const venues = await fetchVenues();

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Link href="/admin" className="text-sm hover:underline" style={{ color: '#8b4513' }}>
          ← Back to Admin
        </Link>
        <div className="flex items-center justify-between mt-2">
          <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>Venues</h1>
          <Link
            href="/admin/venues/new"
            className="text-sm px-4 py-2 rounded font-medium"
            style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
          >
            + Add New Venue
          </Link>
        </div>
      </div>

      {venues.length === 0 ? (
        <p style={{ color: '#8b7355' }}>No venues yet.</p>
      ) : (
        <ul className="space-y-3">
          {(venues as any[]).map((venue: any) => (
            <li key={venue.id}>
              <Link
                href={`/admin/venues/${venue.id}`}
                className="block p-4 rounded-lg border transition-colors hover:bg-amber-50"
                style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
              >
                <div className="font-semibold" style={{ color: '#2c1810' }}>{venue.name}</div>
                <div className="text-sm mt-0.5" style={{ color: '#8b7355' }}>
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
