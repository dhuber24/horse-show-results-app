import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';

async function getDashboard() {
  const API_URL = process.env.API_URL || 'http://backend:8000';
  const session = await auth();
  if (!session) redirect('/login');
  const userId = (session.user as any).id;
  const res = await fetch(`${API_URL}/dashboard/exhibitor/${userId}`, { cache: 'no-store' });
  return res.json();
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect('/login');
  const data = await getDashboard();

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold" style={{ color: '#2c1810' }}>My Entries</h2>
        {data.exhibitor && (
          <p className="text-sm mt-1" style={{ color: '#8b7355' }}>{data.exhibitor.full_name}</p>
        )}
      </div>

      {!data.exhibitor ? (
        <div className="rounded-lg border p-4" style={{ backgroundColor: '#fdf8e8', borderColor: '#c4860a' }}>
          <p className="font-medium" style={{ color: '#8b6200' }}>No exhibitor profile linked to your account.</p>
          <p className="text-sm mt-1" style={{ color: '#8b7355' }}>Contact the show admin to link your entries.</p>
        </div>
      ) : data.entries.length === 0 ? (
        <p style={{ color: '#8b7355' }}>No entries found.</p>
      ) : (
        <ul className="space-y-3">
          {data.entries.map((entry: any) => (
            <li key={entry.entry_id}>
              <Link href={`/shows/${entry.show_id}/classes/${entry.class_id}`}
                className="block p-4 rounded-lg border transition hover:shadow-md"
                style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}>
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate" style={{ color: '#2c1810' }}>
                      {entry.class_number} — {entry.class_name}
                    </div>
                    <div className="text-sm mt-1" style={{ color: '#8b7355' }}>
                      {entry.show_name}
                    </div>
                    <div className="text-sm" style={{ color: '#8b7355' }}>
                      🐴 {entry.horse_name} &nbsp;·&nbsp; # {entry.back_number ?? '—'}
                    </div>
                  </div>
                  <div className="ml-4 text-right">
                    {entry.place ? (
                      <div>
                        <div className="text-3xl font-bold" style={{ color: '#8b4513' }}>
                          {entry.place}{entry.is_tie ? 'T' : ''}
                        </div>
                        <div className="text-xs" style={{ color: '#8b7355' }}>place</div>
                      </div>
                    ) : (
                      <span className="text-sm" style={{ color: '#8b7355' }}>Pending</span>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
