import { fetchShow, fetchShowMaps } from '@/lib/api';
import ShowMapsCard from './ShowMapsCard';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import LodgingClient, { type FeeRow } from './LodgingClient';
import StepLayout from '../_lib/StepLayout';
import { fetchStepCounts, isLodgingStepFee } from '../_lib/fetchStepCounts';
import type { StallPeriod } from '@/lib/stall-periods';

async function fetchAuthed<T>(url: string, fallback: T): Promise<T> {
  const headers = await getAuthHeaders();
  if (!headers) return fallback;
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) return fallback;
  return res.json();
}

// `isLodgingStepFee` takes every line priced per stall (the Stalls card's, by
// unit) and the coded rows, including the older code of each — `hookup` for
// camping, `early_arrival_stall` for the Early Move-In Pass — so a row written
// under it is handed to the card that manages it, instead of sitting outside
// this screen while a new row is created next to it and both are billed.

export default async function SetupLodgingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const show = await fetchShow(id);
  const [allFees, stepsInput, maps, stallPeriods] = await Promise.all([
    fetchAuthed<FeeRow[]>(`${API_URL}/shows/${id}/fees/`, []),
    fetchStepCounts(id),
    fetchShowMaps(id),
    fetchAuthed<StallPeriod[]>(`${API_URL}/shows/${id}/stall-periods`, []),
  ]);
  const lodgingFees = allFees.filter(isLodgingStepFee);

  return (
    <StepLayout
      showId={id}
      showName={show.name}
      current="lodging"
      width="form"
      title="Lodging & Boarding"
      subtitle="General stalling notes for everybody who stalls, then stalls and move-in — when exhibitors move in, any early move-in, and the stalls you sell — then the stall and RV maps, shavings and camping. Each card is optional."
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
        initialStallPeriods={stallPeriods}
        initialStallPerHorse={show.stall_per_horse_required ?? false}
        initialStallInspectionRequired={show.stall_inspection_required ?? false}
        initialStallInspectionFeeCents={show.stall_inspection_fee_cents ?? null}
        allFeeCodes={allFees.map((f) => f.code)}
        initialShavingsBanOutside={show.shavings_ban_outside ?? false}
        initialStallingNotes={show.stalling_notes ?? ''}
        initialStallsOpenDate={show.stalls_open_date ?? ''}
        initialStallsOpenTime={(show.stalls_open_time ?? '').slice(0, 5)}
        showStartDate={show.start_date}
        showEndDate={show.end_date}
        // Keyed: React's dev build flags an element handed from a server
        // component to a client one as a list child missing a key once the
        // payload carries non-empty arrays beside it. Harmless, but noisy.
        maps={<ShowMapsCard key="maps" showId={id} initialMaps={maps} />}
      />
    </StepLayout>
  );
}
