import Link from 'next/link';
import { fetchShows } from '@/lib/api';

export default async function Home() {
  const shows = await fetchShows();

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <div className="mb-6 mt-2">
        <h2 className="text-2xl font-bold" style={{ color: '#2c1810' }}>Upcoming Shows</h2>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>Select a show to view classes and results</p>
      </div>
      {shows.length === 0 ? (
        <p style={{ color: '#8b7355' }}>No shows found.</p>
      ) : (
        <ul className="space-y-3">
          {shows.map((show: any) => (
            <li key={show.id}>
              <Link href={`/shows/${show.id}`}
                className="block p-4 rounded-lg border transition hover:shadow-md"
                style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}>
                <div className="font-semibold text-lg" style={{ color: '#2c1810' }}>{show.name}</div>
                <div className="text-sm mt-1" style={{ color: '#8b7355' }}>
                  📍 {show.venue} &nbsp;·&nbsp; 📅 {show.start_date} – {show.end_date}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
