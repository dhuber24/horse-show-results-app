import { fetchShow } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import SetupListPanel, { SetupItem } from './SetupListPanel';

type ScoreType = 'placement' | 'pattern' | 'time';

async function fetchAuthed(url: string) {
  const headers = await getAuthHeaders();
  if (!headers) return [];
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

export default async function ShowSetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ missing?: string }>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const missingParam = (sp.missing ?? '').split(',').filter(Boolean);
  const show = await fetchShow(id);
  const [
    rings,
    divisions,
    sections,
    standardRings,
    standardDivisions,
    standardSections,
  ] = await Promise.all([
    fetchAuthed(`${API_URL}/shows/${id}/rings/`) as Promise<SetupItem[]>,
    fetchAuthed(`${API_URL}/shows/${id}/divisions/`) as Promise<SetupItem[]>,
    fetchAuthed(`${API_URL}/shows/${id}/sections/`) as Promise<SetupItem[]>,
    fetchAuthed(`${API_URL}/standard-setup/rings`) as Promise<{ id: string; name: string }[]>,
    fetchAuthed(
      `${API_URL}/standard-setup/divisions?show_type_id=${encodeURIComponent(show.show_type_id)}`,
    ) as Promise<{ id: string; name: string; default_score_type: ScoreType }[]>,
    fetchAuthed(
      `${API_URL}/standard-setup/sections?show_type_id=${encodeURIComponent(show.show_type_id)}`,
    ) as Promise<{ id: string; name: string }[]>,
  ]);

  // Dedupe standard lists by name (case-insensitive) — show-type-specific rows
  // may overlap the generic NULL-show_type_id fallback.
  function dedupeByName<T extends { name: string }>(list: T[]): T[] {
    const seen = new Set<string>();
    return list.filter((d) => {
      const key = d.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  const dedupedDivisions = dedupeByName(standardDivisions);
  const dedupedSections = dedupeByName(standardSections);

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-8">
      <div>
        <Breadcrumbs
          crumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Shows', href: '/admin/shows' },
            { label: show.name, href: `/admin/shows/${id}` },
            { label: 'Rings, Divisions & Sections' },
          ]}
        />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>
          Rings, Divisions &amp; Sections
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          Set up the arenas, disciplines, and age/skill brackets for {show.name}. Classes can then be assigned
          to a ring, a division (discipline), and an optional section (bracket).
        </p>
        {missingParam.length > 0 && (
          <div
            className="mt-3 rounded border p-3 text-sm"
            style={{ borderColor: '#e8b923', backgroundColor: '#fef8e1', color: '#5c3d1e' }}
            role="alert"
          >
            Add at least one {missingParam.join(' and ')} before creating classes. Classes are
            assigned to a ring and a division, so both must exist first.
          </div>
        )}
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
        emptyHint="No divisions configured. A Division is a discipline (Halter, Western Pleasure, Trail, Barrels). Each one carries a default scoring method that newly-created classes inherit."
        pickerHint={`Standard ${show.show_type_code ?? ''} disciplines. Demographic splits (Open / Amateur / Youth) are tracked per entry, not at the division level.`}
      />

      <SetupListPanel
        kind="section"
        showId={id}
        items={sections}
        standardOptions={dedupedSections}
        availableDivisions={divisions.map((d) => ({ id: d.id, name: d.name }))}
        title="Sections"
        emptyHint="No sections configured. A Section is an age or skill bracket within a discipline (10 & Under, Walk-Trot, Amateur). After adding a section, assign it to one or more divisions so classes can use it."
        pickerHint="Standard age/skill brackets. After adding, edit each section to choose which divisions it applies to."
      />
    </main>
  );
}
