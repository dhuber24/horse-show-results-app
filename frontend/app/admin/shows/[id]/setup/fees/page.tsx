import { fetchShow } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import { isClassFeeEditorUnit } from '@/lib/fee-units';
import type { ShowCharge } from '@/components/ShowChargesEditor';
import FeesClient, { type FeeRow, type SanctioningRow } from './FeesClient';
import StepLayout from '../_lib/StepLayout';
import { fetchStepCounts } from '../_lib/fetchStepCounts';

async function fetchAuthed<T>(url: string, fallback: T): Promise<T> {
  const headers = await getAuthHeaders();
  if (!headers) return fallback;
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) return fallback;
  return res.json();
}

// No `futurity` fee code here. It was a single per-entry amount sitting beside
// the jackpot fee, and a futurity cannot be described by one number: the same
// class is priced three ways depending on how the horse got there, entries
// close on a stated date after which every class carries a late fee, and
// there is an office fee per horse that depends on club membership. That
// lives in Step 7 now. Shows set up before migration 107 may still carry the
// old row; the futurity step links to it rather than this screen silently
// repricing anything.
const LEGACY_FUTURITY_CODE = 'futurity';

export default async function SetupFeesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const show = await fetchShow(id);
  const [allFees, sanctioning, judges, classSanctioning, classes, stepsInput] =
    await Promise.all([
      fetchAuthed<FeeRow[]>(`${API_URL}/shows/${id}/fees/`, []),
      fetchAuthed<SanctioningRow[]>(`${API_URL}/shows/${id}/sanctioning/`, []),
      fetchAuthed<unknown[]>(`${API_URL}/shows/${id}/judges/`, []),
      fetchAuthed<{ association_id: string; class_ids: string[] }[]>(
        `${API_URL}/shows/${id}/classes/sanctioning`,
        [],
      ),
      fetchAuthed<unknown[]>(`${API_URL}/shows/${id}/classes/`, []),
      fetchStepCounts(id),
    ]);
  // A per-class sanction fee only bills on classes the club approves, so the
  // amount on its own does not say whether it charges anybody. See migration 113.
  const sanctionedCounts: Record<string, number> = Object.fromEntries(
    classSanctioning.map((c) => [c.association_id, c.class_ids.length]),
  );
  // The show's own class fees, picked out by unit rather than by a list of
  // codes: the whole point is that a manager names their own, so there is no
  // code here to match on. `per_entry` rides along too — a jackpot/sidepot
  // fee is published text rather than an automatic charge, but it is still a
  // class fee and belongs in the same box. See CLASS_FEE_EDITOR_UNITS.
  const charges = allFees.filter((f) => isClassFeeEditorUnit(f.unit)) as ShowCharge[];
  const legacyFuturityFee =
    allFees.find((f) => f.code === LEGACY_FUTURITY_CODE) ?? null;

  return (
    <StepLayout
      showId={id}
      showName={show.name}
      current="fees"
      title="Step 5: Show Fees"
      subtitle="Every class fee this show adds — an office fee, an assessment, an all-day pass, a jackpot line — priced per exhibitor, horse or judge. Per-class pricing is set once classes exist in Step 6; futurity pricing comes from Step 7."
      stepsInput={{ ...stepsInput, feesCount: charges.length > 0 ? 1 : 0 }}
    >
      <FeesClient
        showId={id}
        initialCharges={charges}
        judgeCount={judges.length}
        sanctioning={sanctioning}
        sanctionedCounts={sanctionedCounts}
        classCount={classes.length}
        legacyFuturityFee={legacyFuturityFee}
        futurityCount={stepsInput.futurityCount}
      />
    </StepLayout>
  );
}
