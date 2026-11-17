import { fetchShow, fetchShowMaps } from '@/lib/api';
import ShowMapsCard from './ShowMapsCard';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import LodgingClient, { type FeeRow } from './LodgingClient';
import StepLayout from '../_lib/StepLayout';
import { fetchStepCounts, LODGING_CODES } from '../_lib/fetchStepCounts';

async function fetchAuthed<T>(url: string, fallback: T): Promise<T> {
  const headers = await getAuthHeaders();
  if (!headers) return fallback;
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) return fallback;
  return res.json();
}

// `LODGING_CODES` carries the older code of each line as well as its own —
// `hookup` for camping, `early_arrival_stall` for the Early Move-In Pass — so a
// row written under it is handed to the card that manages it, instead of
// sitting outside this screen while a new row is created next to it and both
// are billed.

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
      subtitle="When stalls open and any Early Move-In Pass, the stall and RV maps, then stall fees, shavings and camping — each its own card, each optional."
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
