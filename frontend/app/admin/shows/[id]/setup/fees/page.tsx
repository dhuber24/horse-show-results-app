import { fetchShow } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import { isAutomaticUnit } from '@/lib/fee-units';
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

// No `futurity` here. It was a single per-entry amount sitting beside the
// jackpot fee, and a futurity cannot be described by one number: the same class
// is priced three ways depending on how the horse got there, entries close on a
// stated date after which every class carries a late fee, and there is an office
// fee per horse that depends on club membership. That lives in Step 7 now.
// Shows set up before migration 107 may still carry the old row; the futurity
// step links to it rather than this screen silently repricing anything.
const FEE_CODES = new Set(['standard_class', 'jackpot']);
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
      fetchStepCounts(id, show.office_charge_cents ?? 0),
    ]);
  // A per-class sanction fee only bills on classes the club approves, so the
  // amount on its own does not say whether it charges anybody. See migration 113.
  const sanctionedCounts: Record<string, number> = Object.fromEntries(
    classSanctioning.map((c) => [c.association_id, c.class_ids.length]),
  );
  const otherFees = allFees.filter((f) => FEE_CODES.has(f.code));
  // The show's own charges, picked out by unit rather than by a list of codes:
  // the whole point is that a manager names their own, so there is no code here
  // to match on. See AUTOMATIC_FEE_UNITS in backend/billing.py.
  const charges = allFees.filter((f) => isAutomaticUnit(f.unit)) as ShowCharge[];
  const legacyFuturityFee =
    allFees.find((f) => f.code === LEGACY_FUTURITY_CODE) ?? null;

  return (
    <StepLayout
      showId={id}
      showName={show.name}
      current="fees"
      title="Step 5: Show Fees"
      subtitle="Office charge, standard class fee, jackpot, and any other fee this show adds per exhibitor, horse or judge. Per-sanctioning class fees come from Step 3; futurity pricing comes from Step 7."
      stepsInput={{
        ...stepsInput,
        feesCount:
          otherFees.length > 0 ||
          charges.length > 0 ||
          (show.office_charge_cents ?? 0) > 0
            ? 1
            : 0,
      }}
    >
      <FeesClient
        showId={id}
        initialOfficeChargeCents={show.office_charge_cents ?? 0}
        initialOfficeChargeBasis={show.office_charge_basis ?? 'per_back_number'}
        initialFees={otherFees}
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
