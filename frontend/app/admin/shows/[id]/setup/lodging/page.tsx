import { fetchShow, fetchShowMaps } from '@/lib/api';
import ShowMapsCard from './ShowMapsCard';
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

// `hookup` is the pre-108 code for what is now the one camping line. Kept so a
// row that somehow escaped the migration is still handed to the slot that
// manages it, instead of sitting outside this screen while a new `camping` row
// is created next to it and both are billed.
const LODGING_CODES = new Set(['stall', 'shavings', 'camping', 'hookup']);

export default async function SetupLodgingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const show = await fetchShow(id);
  const [allFees, stepsInput, maps] = await Promise.all([
    fetchAuthed<FeeRow[]>(`${API_URL}/shows/${id}/fees/`, []),
    fetchStepCounts(id),
    fetchShowMaps(id),
  ]);
  const lodgingFees = allFees.filter((f) => LODGING_CODES.has(f.code));

  return (
    <StepLayout
      showId={id}
      showName={show.name}
      current="lodging"
      width="form"
      title="Lodging & Boarding"
      subtitle="When stalls open, the stall and RV maps, then stall fees, shavings and camping — each its own card, each optional."
      stepsInput={{ ...stepsInput, lodgingFeeCount: lodgingFees.length }}
      skip={
        lodgingFees.length === 0
          ? {
              label: 'Skip — nothing to book here',
              note: 'A day-haul show that sells no stalls, shavings or camping needs none of these. These are the lines exhibitors reserve a quantity of at sign-up; what a class costs is set in the Class Builder.',
            }
          : undefined
      }
    >
      <LodgingClient
        showId={id}
        initialFees={lodgingFees}
        initialShavingsBanOutside={show.shavings_ban_outside ?? false}
        initialStallsOpenDate={show.stalls_open_date ?? ''}
        initialStallsOpenTime={(show.stalls_open_time ?? '').slice(0, 5)}
        showStartDate={show.start_date}
        showEndDate={show.end_date}
        maps={<ShowMapsCard showId={id} initialMaps={maps} />}
      />
    </StepLayout>
  );
}
