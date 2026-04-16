import Link from 'next/link';
import { fetchShows, fetchVenues } from '@/lib/api';

export default async function AdminPage() {
  const [shows, venues] = await Promise.all([fetchShows(), fetchVenues()]);

  return (
    <main className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Admin</h1>
        <Link href="/" className="text-sm text-blue-500 hover:underline">← Back to Shows</Link>
      </div>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-4">Shows</h2>
        <Link
          href="/admin/shows/new"
          className="inline-block bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 mb-4"
        >
          + Create New Show
        </Link>
        {shows.length === 0 ? (
          <p className="text-gray-500">No shows yet.</p>
        ) : (
          <ul className="space-y-3">
            {shows.map((show: any) => (
              <li key={show.id}>
                <Link
                  href={`/admin/shows/${show.id}`}
                  className="block p-4 border rounded-lg hover:bg-gray-50 transition"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{show.name}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      show.status === 'ACTIVE' ? 'bg-green-100 text-green-800' :
                      show.status === 'PUBLISHED' ? 'bg-amber-100 text-amber-800' :
                      show.status === 'COMPLETED' ? 'bg-blue-100 text-blue-800' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {show.status}
                    </span>
                  </div>
                  <div className="text-sm text-gray-500">{show.venue} · {show.start_date} – {show.end_date}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-4">Venues</h2>
        <Link
          href="/admin/venues/new"
          className="inline-block bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 mb-4"
        >
          + Add New Venue
        </Link>
        {venues.length === 0 ? (
          <p className="text-gray-500">No venues yet.</p>
        ) : (
          <ul className="space-y-3">
            {(venues as any[]).map((venue: any) => (
              <li key={venue.id}>
                <Link
                  href={`/admin/venues/${venue.id}`}
                  className="block p-3 border rounded-lg hover:bg-gray-50 transition"
                >
                  <div className="font-semibold">{venue.name}</div>
                  <div className="text-sm text-gray-500">
                    {[venue.address, venue.city, venue.state].filter(Boolean).join(', ') || 'No address'}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-4">Exhibitors & Horses</h2>
        <Link
          href="/admin/exhibitors"
          className="block p-4 border rounded-lg hover:bg-gray-50 transition"
        >
          <div className="font-semibold">Manage Exhibitors & Horses</div>
          <div className="text-sm text-gray-500">View all exhibitors, edit names, and see horse associations</div>
        </Link>
      </section>
    </main>
  );
}
