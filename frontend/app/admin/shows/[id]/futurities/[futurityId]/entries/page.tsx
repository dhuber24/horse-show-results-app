import { notFound } from 'next/navigation';
import { fetchShow } from '@/lib/api';
import Breadcrumbs from '@/components/Breadcrumbs';
import { getAuthHeaders, API_URL, readJsonBody } from '@/lib/backend-fetch';
import { loadFuturity, loadFuturityEntries } from '../../loadFuturity';
import { BackToFuturity, COLORS, futurityCrumbs } from '../../futurity-shared';
import FuturityEntriesPanel from './FuturityEntriesPanel';

async function loadRoster(showId: string, futurityId: string) {
  const headers = await getAuthHeaders();
  if (!headers) return [];
  const res = await fetch(
    `${API_URL}/shows/${showId}/futurities/${futurityId}/roster`,
    { headers, cache: 'no-store' },
  );
  if (!res.ok) return [];
  return (await readJsonBody(res)) ?? [];
}

export default async function FuturityEntriesPage({
  params,
}: {
  params: Promise<{ id: string; futurityId: string }>;
}) {
  const { id, futurityId } = await params;
  const [show, futurity, entries, roster] = await Promise.all([
    fetchShow(id),
    loadFuturity(id, futurityId),
    loadFuturityEntries(id, futurityId),
    loadRoster(id, futurityId),
  ]);
  if (!futurity) notFound();

  return (
    <main className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={futurityCrumbs(id, show.name, futurity, 'Entries')} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: COLORS.text }}>
          Entries
        </h1>
        <p className="text-sm mt-1" style={{ color: COLORS.muted }}>
          {futurity.name} — one row per horse. What each is charged is the
          category rate times the futurity classes it is entered in, plus the
          office fee.
        </p>
      </div>

      <FuturityEntriesPanel
        showId={id}
        futurity={futurity}
        initialEntries={entries}
        roster={roster}
      />

      <BackToFuturity showId={id} futurity={futurity} />
    </main>
  );
}
