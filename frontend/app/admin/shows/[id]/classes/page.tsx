import Link from 'next/link';
import { fetchShow, fetchClasses, fetchShowTypes, fetchDisciplines, fetchDivisions } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import ClassWizardClient, {
  type DisciplineItem,
  type DivisionItem,
  type ClassItem,
  type StandardItem,
} from './_wizard/ClassWizardClient';

async function fetchAuthed<T>(url: string, fallback: T): Promise<T> {
  const headers = await getAuthHeaders();
  if (!headers) return fallback;
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) return fallback;
  return res.json();
}

async function fetchStandardLibrary(
  showTypes: { id: string; code: string }[],
): Promise<{ disciplines: StandardItem[]; divisions: StandardItem[] }> {
  // OPEN's class wizard pulls from the AQHA + APHA standard catalogs — the
  // disciplines and divisions both associations use are a good starting
  // point for an unaffiliated show, and the secretary can still add custom.
  const breedCodes = ['AQHA', 'APHA'];
  const breedIds = showTypes.filter((t) => breedCodes.includes(t.code)).map((t) => t.id);

  const disciplineLists = await Promise.all(
    breedIds.map((id) =>
      fetchAuthed<StandardItem[]>(
        `${API_URL}/standard-setup/disciplines?show_type_id=${encodeURIComponent(id)}`,
        [],
      ),
    ),
  );
  const divisionLists = await Promise.all(
    breedIds.map((id) =>
      fetchAuthed<StandardItem[]>(
        `${API_URL}/standard-setup/divisions?show_type_id=${encodeURIComponent(id)}`,
        [],
      ),
    ),
  );

  function dedupe(lists: StandardItem[][]): StandardItem[] {
    const seen = new Map<string, StandardItem>();
    for (const list of lists) {
      for (const item of list) {
        const key = item.name.trim().toLowerCase();
        if (key && !seen.has(key)) seen.set(key, item);
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  return {
    disciplines: dedupe(disciplineLists),
    divisions: dedupe(divisionLists),
  };
}

export default async function ShowClassesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const show = await fetchShow(id);

  if (show.show_type_code !== 'OPEN') {
    return (
      <main className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
        <Breadcrumbs
          crumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Shows', href: '/admin/shows' },
            { label: show.name, href: `/admin/shows/${id}` },
            { label: 'Classes' },
          ]}
        />
        <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>
          Classes
        </h1>
        <div
          className="rounded border p-4 text-sm"
          style={{ borderColor: '#d4b896', backgroundColor: '#fdf8eb', color: '#5c3d1e' }}
        >
          Class setup for {show.show_type_code ?? 'this show type'} is being rebuilt.
          The new OPEN wizard ships first; per-association flows come next.
        </div>
        <Link href={`/admin/shows/${id}`} className="text-sm hover:underline" style={{ color: '#8b4513' }}>
          ← Back to show
        </Link>
      </main>
    );
  }

  const [showTypes, disciplines, divisions, classes] = await Promise.all([
    fetchShowTypes(),
    fetchDisciplines(id),
    fetchDivisions(id),
    fetchClasses(id),
  ]);
  const standardLibrary = await fetchStandardLibrary(showTypes);

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs
          crumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Shows', href: '/admin/shows' },
            { label: show.name, href: `/admin/shows/${id}` },
            { label: 'Classes' },
          ]}
        />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>
          Class Setup
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          {show.name} — three steps: pick disciplines, pick divisions, build classes.
        </p>
      </div>

      <ClassWizardClient
        showId={id}
        showStartDate={show.start_date}
        initialDisciplines={disciplines as DisciplineItem[]}
        initialDivisions={divisions as DivisionItem[]}
        initialClasses={classes as ClassItem[]}
        standardDisciplines={standardLibrary.disciplines}
        standardDivisions={standardLibrary.divisions}
      />
    </main>
  );
}
