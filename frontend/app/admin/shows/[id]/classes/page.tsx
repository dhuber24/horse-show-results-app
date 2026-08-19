import Link from 'next/link';
import { fetchShow, fetchClasses, fetchShowTypes, fetchDisciplines, fetchDivisions } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import StepLayout from '../setup/_lib/StepLayout';
import { fetchStepCounts } from '../setup/_lib/fetchStepCounts';
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

/** Setup Step 6. Building the schedule is the longest job in setting a show up,
 *  so it sits in the wizard with the rest of it rather than behind its own
 *  dashboard tile. The route is unchanged — deep links into class setup and the
 *  per-class screens still work. */
export default async function ShowClassesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const show = await fetchShow(id);
  const stepsInput = await fetchStepCounts(id, show.office_charge_cents ?? 0);

  if (show.show_type_code !== 'OPEN') {
    return (
      <StepLayout
        showId={id}
        showName={show.name}
        current="classes"
        title="Step 6: Classes"
        subtitle="Build the class schedule for this show."
        stepsInput={stepsInput}
      >
        <div
          className="rounded border p-4 text-sm space-y-2"
          style={{ borderColor: '#d4b896', backgroundColor: '#fdf8eb', color: '#5c3d1e' }}
        >
          <p>
            Class setup for {show.show_type_code ?? 'this show type'} is being rebuilt.
            The new OPEN wizard ships first; per-association flows come next.
          </p>
          <Link href={`/admin/shows/${id}`} className="hover:underline" style={{ color: '#8b4513' }}>
            ← Back to show
          </Link>
        </div>
      </StepLayout>
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
    <StepLayout
      showId={id}
      showName={show.name}
      current="classes"
      title="Step 6: Classes"
      subtitle="Three steps: pick disciplines, pick divisions, build classes."
      stepsInput={stepsInput}
    >
      <ClassWizardClient
        showId={id}
        showStartDate={show.start_date}
        showEndDate={show.end_date}
        initialDisciplines={disciplines as DisciplineItem[]}
        initialDivisions={divisions as DivisionItem[]}
        initialClasses={classes as ClassItem[]}
        standardDisciplines={standardLibrary.disciplines}
        standardDivisions={standardLibrary.divisions}
      />
    </StepLayout>
  );
}
