import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, safeFetchBackend, API_URL } from '@/lib/backend-fetch';

/** Post a class's placings to the public /live and /results screens.
 *  Until this runs, results autosave as a staff-only draft. */
export async function POST(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { showId, classId, acknowledge_incomplete, acknowledge_ties } = await request.json();
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/classes/${classId}/results/publish`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      // Two separate questions the backend can refuse on, each with its own
      // acknowledgement: a placing-depth shortfall (APHA SC-110.I) asks whether
      // the card is finished, an unbroken tie (AM-115.B.2) asks which of two
      // horses won. The backend names each; a human decides.
      body: JSON.stringify({
        acknowledge_incomplete: acknowledge_incomplete === true,
        acknowledge_ties: acknowledge_ties === true,
      }),
    },
  );
  return NextResponse.json(json, { status });
}
