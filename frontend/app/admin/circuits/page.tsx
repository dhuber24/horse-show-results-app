import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import Breadcrumbs from '@/components/Breadcrumbs';
import { fetchCircuits, fetchPointSystems } from '@/lib/api';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';
import CircuitsManager, { type ShowOption } from './CircuitsManager';

/**
 * Season circuits (migration 147) — several shows whose posted placings add up
 * to one set of season standings. Show managers and secretaries set up their
 * own; a GaitDesk admin can manage any.
 */
export default async function AdminCircuitsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const user = session.user as { id: string; role?: string };
  if (!['ADMIN', 'SHOW_MANAGER', 'SHOW_SECRETARY'].includes(user.role ?? '')) redirect('/admin');

  const headers = await getAuthHeaders();
  const loadMyShows = async (): Promise<ShowOption[]> => {
    if (!headers) return [];
    const res = await fetch(`${API_URL}/shows/`, { headers, cache: 'no-store' }).catch(() => null);
    if (!res?.ok) return [];
    return ((await readJsonBody(res)) ?? []).map((s: ShowOption) => ({
      id: s.id,
      name: s.name,
      start_date: s.start_date,
      status: s.status,
    }));
  };
  const [circuits, systems, myShows] = await Promise.all([
    fetchCircuits(headers ?? undefined),
    fetchPointSystems(headers),
    loadMyShows(),
  ]);

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Season Circuits' }]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: 'var(--foreground)' }}>Season Circuits</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          A circuit adds several shows together for a season high point. Every posted class at a
          show in the circuit earns points under the circuit&apos;s own points system, and the
          standings are public on the circuit&apos;s page and linked from each show&apos;s
          leaderboard.
        </p>
      </div>
      <CircuitsManager
        initialCircuits={circuits}
        myShows={myShows}
        systems={systems.map((s) => ({ id: s.id, name: s.standard ? `${s.name} — GaitDesk standard` : s.name }))}
        userId={user.id}
        isAdmin={user.role === 'ADMIN'}
      />
    </main>
  );
}
