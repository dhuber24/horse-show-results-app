import { fetchShow } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import LodgingClient, { type FeeRow } from './LodgingClient';
import StepLayout from '../_lib/StepLayout';
import { fetchStepCounts } from '../_lib/fetchStepCounts';

async function fetchAuthed<T>(url: string, fallback: T): Promise<T> {
  const headers = await getAuthHeaders();
  if (!headers) return fallback;
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) return fallback;
  return res.json();
}

const LODGING_CODES = new Set(['stall', 'shavings', 'camping', 'hookup']);

export default async function SetupLodgingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const show = await fetchShow(id);
  const [allFees, stepsInput] = await Promise.all([
    fetchAuthed<FeeRow[]>(`${API_URL}/shows/${id}/fees/`, []),
    fetchStepCounts(id, show.office_charge_cents ?? 0),
  ]);
  const lodgingFees = allFees.filter((f) => LODGING_CODES.has(f.code));

  return (
    <StepLayout
      showId={id}
      showName={show.name}
      current="lodging"
      title="Step 4: Lodging & Boarding"
      subtitle="Stall fees, shavings, and camping. Skip any that don't apply."
      stepsInput={{ ...stepsInput, lodgingFeeCount: lodgingFees.length }}
    >
      <LodgingClient
        showId={id}
        initialFees={lodgingFees}
        initialShavingsBanOutside={show.shavings_ban_outside ?? false}
      />
    </StepLayout>
  );
}
