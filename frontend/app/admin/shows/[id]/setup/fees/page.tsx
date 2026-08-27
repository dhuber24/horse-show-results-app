import { fetchShow } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
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
  const [allFees, sanctioning, stepsInput] = await Promise.all([
    fetchAuthed<FeeRow[]>(`${API_URL}/shows/${id}/fees/`, []),
    fetchAuthed<SanctioningRow[]>(`${API_URL}/shows/${id}/sanctioning/`, []),
    fetchStepCounts(id, show.office_charge_cents ?? 0),
  ]);
  const otherFees = allFees.filter((f) => FEE_CODES.has(f.code));
  const legacyFuturityFee =
    allFees.find((f) => f.code === LEGACY_FUTURITY_CODE) ?? null;

  return (
    <StepLayout
      showId={id}
      showName={show.name}
      current="fees"
      title="Step 5: Show Fees"
      subtitle="Office charge, standard class fee, and jackpot. Per-sanctioning class fees come from Step 3; futurity pricing comes from Step 7."
      stepsInput={{
        ...stepsInput,
        feesCount: otherFees.length > 0 || (show.office_charge_cents ?? 0) > 0 ? 1 : 0,
      }}
    >
      <FeesClient
        showId={id}
        initialOfficeChargeCents={show.office_charge_cents ?? 0}
        initialOfficeChargeBasis={show.office_charge_basis ?? 'per_back_number'}
        initialFees={otherFees}
        sanctioning={sanctioning}
        legacyFuturityFee={legacyFuturityFee}
        futurityCount={stepsInput.futurityCount}
      />
    </StepLayout>
  );
}
