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

const FEE_CODES = new Set(['standard_class', 'jackpot', 'futurity']);

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

  return (
    <StepLayout
      showId={id}
      showName={show.name}
      current="fees"
      title="Step 5: Show Fees"
      subtitle="Office charge, standard class fee, jackpot, and futurity. Per-sanctioning class fees come from Step 3."
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
      />
    </StepLayout>
  );
}
