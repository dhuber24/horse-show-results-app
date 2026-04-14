import Link from 'next/link';
import { fetchShows } from '@/lib/api';
import CreateShowForm from './CreateShowForm';

export default async function AdminPage() {
  const shows = await fetchShows();

  return (
    <main className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Admin</h1>
        <Link href="/" className="text-sm text-blue-500 hover:underline">← Back to Shows</Link>
      </div>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-4">Create New Show</h2>
        <CreateShowForm />
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-4">Riders & Horses</h2>
        <Link
          href="/admin/riders"
          className="block p-4 border rounded-lg hover:bg-gray-50 transition"
        >
          <div className="font-semibold">Manage Riders & Horses</div>
          <div className="text-sm text-gray-500">View all riders, edit names, and see horse associations</div>
        </Link>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-4">Manage Existing Shows</h2>
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
                  <div className="font-semibold">{show.name}</div>
                  <div className="text-sm text-gray-500">{show.venue} · {show.start_date} – {show.end_date}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
