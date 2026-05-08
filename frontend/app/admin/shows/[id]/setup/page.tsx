import { fetchShow } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import SetupListPanel, { SetupItem } from './SetupListPanel';

async function fetchAuthed(url: string) {
  const headers = await getAuthHeaders();
  if (!headers) return [];
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

export default async function ShowSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const show = await fetchShow(id);
  const [rings, divisions, standardRings, standardDivisions] = await Promise.all([
    fetchAuthed(`${API_URL}/shows/${id}/rings/`) as Promise<SetupItem[]>,
    fetchAuthed(`${API_URL}/shows/${id}/divisions/`) as Promise<SetupItem[]>,
    fetchAuthed(`${API_URL}/standard-setup/rings`) as Promise<{ id: string; name: string }[]>,
    fetchAuthed(
      `${API_URL}/standard-setup/divisions?show_type_id=${encodeURIComponent(show.show_type_id)}`,
    ) as Promise<{ id: string; name: string }[]>,
  ]);

  // Standard division endpoint returns the show-type rows plus generic
  // fallbacks. Dedupe by name (case-insensitive) so the picker stays clean.
  const seen = new Set<string>();
  const dedupedDivisions = standardDivisions.filter((d) => {
    const key = d.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-8">
      <div>
        <Breadcrumbs
          crumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Shows', href: '/admin/shows' },
            { label: show.name, href: `/admin/shows/${id}` },
            { label: 'Rings & Divisions' },
          ]}
        />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>
          Rings &amp; Divisions
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          Set up the arenas and class groupings for {show.name}. Classes can then be assigned to a
          ring or division when you create or edit them.
        </p>
      </div>

      <SetupListPanel
        kind="ring"
        showId={id}
        items={rings}
        standardOptions={standardRings}
        title="Rings"
        emptyHint="No rings configured. Add one below — useful for shows that run more than one arena in parallel."
        pickerHint="Select common ring/arena names to add. You can rename them after."
      />

      <SetupListPanel
        kind="division"
        showId={id}
        items={divisions}
        standardOptions={dedupedDivisions}
        title="Divisions"
        emptyHint="No divisions configured. Divisions group classes (e.g. Halter, Western Pleasure, Trail) for scheduling and points."
        pickerHint={`Standard ${show.show_type_code ?? ''} divisions. Demographic splits (Open / Amateur / Youth) are tracked per entry, not at the division level.`}
      />
    </main>
  );
}
