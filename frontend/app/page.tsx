import Link from 'next/link';
import { fetchShows } from '@/lib/api';

export default async function Home() {
  const shows = await fetchShows();

  return (
    <main className="max-w-3xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">🐴 Horse Show Results</h1>
      {shows.length === 0 ? (
        <p className="text-gray-500">No shows found.</p>
      ) : (
        <ul className="space-y-3">
          {shows.map((show: any) => (
            <li key={show.id}>
              <Link
                href={`/shows/${show.id}`}
                className="block p-4 border rounded-lg hover:bg-gray-50 transition"
              >
                <div className="font-semibold text-lg">{show.name}</div>
                <div className="text-sm text-gray-500">{show.venue} · {show.start_date} – {show.end_date}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
