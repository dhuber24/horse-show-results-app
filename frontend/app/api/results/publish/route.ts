import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, safeFetchBackend, API_URL } from '@/lib/backend-fetch';

/** Post a class's placings to the public /live and /results screens.
 *  Until this runs, results autosave as a staff-only draft. */
export async function POST(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { showId, classId, acknowledge_incomplete } = await request.json();
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/classes/${classId}/results/publish`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      // Posting past an association placing-depth shortfall (APHA SC-110.I).
      // The backend names the gap; a human decides.
      body: JSON.stringify({ acknowledge_incomplete: acknowledge_incomplete === true }),
    },
  );
  return NextResponse.json(json, { status });
}
