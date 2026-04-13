import Link from 'next/link';
import { fetchShows } from '@/lib/api';
import { auth } from '@/auth';
import SignOutButton from './SignOutButton';

export default async function Home() {
  const shows = await fetchShows();
  const session = await auth();
  const role = (session?.user as any)?.role;

  return (
    <main className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">🐴 Horse Show Results</h1>
        <div className="flex items-center gap-3">
          {session ? (
            <>
              <span className="text-sm text-gray-500">{session.user?.name} · {role}</span>
              {role === 'ADMIN' && (
                <Link href="/admin" className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded">
                  Admin
                </Link>
              )}
              <SignOutButton />
            </>
          ) : (
            <Link href="/login" className="text-sm bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700">
              Sign In
            </Link>
          )}
        </div>
      </div>
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
