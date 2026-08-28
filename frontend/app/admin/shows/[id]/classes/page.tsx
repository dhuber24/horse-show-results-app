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
  showTypeId: string,
  showTypeCode: string | null,
): Promise<{ disciplines: StandardItem[]; divisions: StandardItem[]; label: string }> {
  // A breed show picks from its own association's catalog. OPEN has no
  // association of its own, so it pulls the AQHA + APHA standard catalogs
  // instead - the disciplines and divisions both associations run are a good
  // starting point for an unaffiliated show. Either way the endpoint adds the
  // generic (show_type_id NULL) fallback rows, and the secretary can still
  // add anything custom.
  const isOpen = showTypeCode === 'OPEN';
  const sourceIds = isOpen
    ? showTypes.filter((t) => t.code === 'AQHA' || t.code === 'APHA').map((t) => t.id)
    : [showTypeId];
  const label = isOpen ? 'AQHA / APHA shared' : (showTypeCode ?? 'standard');

  const disciplineLists = await Promise.all(
    sourceIds.map((id) =>
      fetchAuthed<StandardItem[]>(
        `${API_URL}/standard-setup/disciplines?show_type_id=${encodeURIComponent(id)}`,
        [],
      ),
    ),
  );
  const divisionLists = await Promise.all(
    sourceIds.map((id) =>
      fetchAuthed<StandardItem[]>(
        `${API_URL}/standard-setup/divisions?show_type_id=${encodeURIComponent(id)}`,
        [],
      ),
    ),
  );

  // The association's own row beats the generic fallback of the same name -
  // both come back in one list, and the association's carries its score type
  // and its running order.
  function dedupe(lists: StandardItem[][]): StandardItem[] {
    const seen = new Map<string, StandardItem>();
    for (const list of lists) {
      for (const item of list) {
        const key = item.name.trim().toLowerCase();
        if (!key) continue;
        const held = seen.get(key);
        if (!held || (!held.show_type_id && item.show_type_id)) seen.set(key, item);
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  return {
    disciplines: dedupe(disciplineLists),
    divisions: dedupe(divisionLists),
    label,
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

  const [showTypes, disciplines, divisions, classes, clubs] = await Promise.all([
    fetchShowTypes(),
    fetchDisciplines(id),
    fetchDivisions(id),
    fetchClasses(id),
    fetchAuthed<{ association_id: string; code: string; class_ids: string[] }[]>(
      `${API_URL}/shows/${id}/classes/sanctioning`,
      [],
    ),
  ]);
  const standardLibrary = await fetchStandardLibrary(
    showTypes,
    show.show_type_id,
    show.show_type_code ?? null,
  );

  return (
    <StepLayout
      showId={id}
      showName={show.name}
      current="classes"
      title="Step 6: Classes"
      subtitle="Three steps: pick disciplines, pick divisions, build classes. If a club sanctions this show, say which of these classes it approves in Sanctioned Classes."
      stepsInput={stepsInput}
    >
      {clubs.length > 0 && (
        <div
          className="rounded border p-3 mb-4 text-sm flex items-center justify-between gap-3 flex-wrap"
          style={{ borderColor: '#d4b896', backgroundColor: '#fdf8eb', color: '#5c3d1e' }}
        >
          <span>
            {clubs
              .map((c) => `${c.code} (${c.class_ids.length} class${c.class_ids.length === 1 ? '' : 'es'})`)
              .join(', ')}{' '}
            — a club approves a list of classes, not the whole schedule, and its
            per-class fee is charged on those classes only.
          </span>
          <Link
            href={`/admin/shows/${id}/classes/sanctioning`}
            className="underline whitespace-nowrap"
            style={{ color: '#8b4513' }}
          >
            Sanctioned Classes →
          </Link>
        </div>
      )}

      <ClassWizardClient
        showId={id}
        showStartDate={show.start_date}
        showEndDate={show.end_date}
        initialDisciplines={disciplines as DisciplineItem[]}
        initialDivisions={divisions as DivisionItem[]}
        initialClasses={classes as ClassItem[]}
        standardDisciplines={standardLibrary.disciplines}
        standardDivisions={standardLibrary.divisions}
        standardLibraryLabel={standardLibrary.label}
      />
    </StepLayout>
  );
}
