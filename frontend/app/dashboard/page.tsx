import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';

async function getDashboard() {
  const API_URL = process.env.API_URL || 'http://backend:8000';
  const session = await auth();
  if (!session) redirect('/login');
  const userId = (session.user as any).id;
  const res = await fetch(`${API_URL}/dashboard/rider/${userId}`, { cache: 'no-store' });
  return res.json();
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect('/login');

  const data = await getDashboard();

  return (
    <main className="max-w-3xl mx-auto p-6">
      <h2 className="text-2xl font-bold mb-2">My Dashboard</h2>

      {!data.rider ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mt-4">
          <p className="text-yellow-800 font-medium">No rider profile linked to your account.</p>
          <p className="text-yellow-700 text-sm mt-1">Contact the show admin to link your entries.</p>
        </div>
      ) : (
        <>
          <p className="text-gray-500 mb-6">Showing entries for {data.rider.full_name}</p>

          {data.entries.length === 0 ? (
            <p className="text-gray-500">No entries found.</p>
          ) : (
            <ul className="space-y-3">
              {data.entries.map((entry: any) => (
                <li key={entry.entry_id}>
                  <Link
                    href={`/shows/${entry.show_id}/classes/${entry.class_id}`}
                    className="block p-4 border rounded-lg hover:bg-gray-50 transition bg-white"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold">{entry.class_number} — {entry.class_name}</div>
                        <div className="text-sm text-gray-500">{entry.show_name} · {entry.class_date}</div>
                        <div className="text-sm text-gray-500">Horse: {entry.horse_name} · Back #: {entry.back_number ?? '—'}</div>
                      </div>
                      <div className="text-right">
                        {entry.place ? (
                          <span className="text-2xl font-bold text-blue-600">
                            {entry.place}{entry.is_tie ? 'T' : ''}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-sm">No result yet</span>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
