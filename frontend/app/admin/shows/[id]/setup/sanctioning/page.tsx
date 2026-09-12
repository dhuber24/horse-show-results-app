import { fetchShow, fetchClasses } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import SanctioningClient, {
  type AssociationOption,
  type ClassSanctioningRow,
  type SanctionedClass,
  type ShowSanctioningRow,
} from './SanctioningClient';
import StepLayout from '../_lib/StepLayout';
import { fetchStepCounts } from '../_lib/fetchStepCounts';

async function fetchAuthed<T>(url: string, fallback: T): Promise<T> {
  const headers = await getAuthHeaders();
  if (!headers) return fallback;
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) return fallback;
  return res.json();
}

/**
 * Step 5: club sanctioning, all three of its questions on one screen.
 *
 * After the Class Builder, not before it. Which clubs sanction the show can be
 * answered any time; what each charges per class and which classes it approves
 * cannot be answered without a schedule — and the fee only bills where all
 * three exist, which is why splitting them across three screens produced
 * sanctions that charged nobody.
 */
export default async function SetupSanctioningPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const show = await fetchShow(id);
  const [associations, current, classSanctioning, classes, judges, stepsInput] =
    await Promise.all([
      fetchAuthed<AssociationOption[]>(`${API_URL}/sanctioned-associations/`, []),
      fetchAuthed<ShowSanctioningRow[]>(`${API_URL}/shows/${id}/sanctioning/`, []),
      fetchAuthed<ClassSanctioningRow[]>(
        `${API_URL}/shows/${id}/classes/sanctioning`,
        [],
      ),
      fetchClasses(id),
      // A club may price its sanction per judge (migration 133), which
      // multiplies by the panel — so the screen can say what that comes to,
      // and say when a panel with nobody on it means the fee charges nothing.
      fetchAuthed<unknown[]>(`${API_URL}/shows/${id}/judges/`, []),
      fetchStepCounts(id),
    ]);

  return (
    <StepLayout
      showId={id}
      showName={show.name}
      current="sanctioning"
      title="Step 5: Sanctioning"
      subtitle="Optional. Pick the clubs whose points apply, set what each charges and how, and tick the classes each one approves — a club sanctions a list of classes, not the whole schedule."
      stepsInput={{ ...stepsInput, sanctioningCount: current.length }}
      skipLabel="Skip — no club sanctioning"
    >
      <SanctioningClient
        showId={id}
        associations={associations}
        current={current}
        classSanctioning={classSanctioning}
        classes={classes as SanctionedClass[]}
        judgeCount={judges.length}
      />
    </StepLayout>
  );
}
