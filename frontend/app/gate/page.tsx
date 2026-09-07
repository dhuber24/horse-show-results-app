import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

type Show = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
  venue?: { name?: string } | null;
};

export default async function GateShowsPage() {
  const session = await auth();
  const role = (session?.user as any)?.role;

  if (!session || !['GATE_STEWARD', 'ADMIN', 'SHOW_MANAGER', 'SHOW_SECRETARY'].includes(role)) {
    redirect('/');
  }

  const headers = await getAuthHeaders();
  const showsRes = await fetch(`${API_URL}/shows/`, { headers: headers ?? {}, cache: 'no-store' });
  const shows: Show[] = showsRes.ok ? await showsRes.json() : [];
  const visible = shows.filter(s => s.status !== 'DRAFT');

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <div className="mb-6 mt-2">
        <h2 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>Gate — My Shows</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Shows where you manage the in-gate and order-of-go
        </p>
      </div>
      {visible.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>
          You haven&apos;t been assigned to any shows yet. Contact your show secretary.
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map(show => (
            <li key={show.id}>
              <Link
                href={`/gate/${show.id}`}
                className="block p-4 rounded-lg border hover:shadow transition"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
              >
                <div className="font-semibold" style={{ color: 'var(--foreground)' }}>{show.name}</div>
                <div className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
                  {show.start_date} – {show.end_date}
                  {show.status === 'ACTIVE' ? ' · Active' : ''}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
