import { fetchShow, fetchClasses, fetchShowTypes, fetchDisciplines, fetchDivisions } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import StepLayout from '../setup/_lib/StepLayout';
import { fetchStepCounts } from '../setup/_lib/fetchStepCounts';
import { buildSteps } from '../../_wizard/steps';
import ClassWizardClient, {
  type DisciplineItem,
  type DivisionItem,
  type ClassItem,
  type NextSetupStep,
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

/** Setup Step 4: the Class Builder. Building the schedule is the longest job in
 *  setting a show up, so it sits in the wizard with the rest of it rather than
 *  behind its own dashboard tile. The route is unchanged — deep links into class
 *  setup and the per-class screens still work.
 *
 *  Ahead of Sanctioning, Futurities and Fees, because all three pick from the
 *  class list: which classes a club approves, which belong to a futurity, and
 *  which classes a fee is narrowed to.
 *
 *  It carried two yellow notices at the top, one linking to Sanctioned Classes
 *  and one to Judging Cards. Both are steps of their own now (5 and 8), which
 *  the stepper above already shows and the Next link already walks into. A
 *  banner pointing at the next step is a second door, and it sat above the
 *  three-screen wizard somebody came here to use. */
export default async function ShowClassesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const show = await fetchShow(id);
  const stepsInput = await fetchStepCounts(id);

  const [showTypes, disciplines, divisions, classes] = await Promise.all([
    fetchShowTypes(),
    fetchDisciplines(id),
    fetchDivisions(id),
    fetchClasses(id),
  ]);
  const standardLibrary = await fetchStandardLibrary(
    showTypes,
    show.show_type_id,
    show.show_type_code ?? null,
  );

  // Build Classes ends by walking into whichever setup step follows this one,
  // named the way the stepper names it, so the last button in the Class
  // Builder says where it goes rather than just "Finish".
  const steps = buildSteps(stepsInput);
  const here = steps.findIndex((s) => s.key === 'classes');
  const following = here >= 0 ? steps[here + 1] : undefined;
  const nextStep: NextSetupStep | null = following?.href
    ? {
        href: following.href,
        label: following.label.replace(/^(\d+)\.\s*/, 'Step $1: '),
      }
    : null;

  return (
    <StepLayout
      showId={id}
      showName={show.name}
      current="classes"
      title="Step 4: Class Builder"
      subtitle="Everything the steps after this one ask about — which classes a club approves, which belong to a futurity, which classes a fee applies to, which card each scored class is marked on — is picked from the classes you build here."
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
        standardLibraryLabel={standardLibrary.label}
        nextStep={nextStep}
      />
    </StepLayout>
  );
}
