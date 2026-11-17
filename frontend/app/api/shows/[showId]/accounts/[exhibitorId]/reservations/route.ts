import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Set an exhibitor's stalls, shavings and camping as the office has them — the
 * whole booking, a line left out booked at nought. GaitDesk does not run the
 * stall chart; this is how the bill follows the one the office keeps.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ showId: string; exhibitorId: string }> },
) {
  const { showId, exhibitorId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/accounts/${exhibitorId}/reservations`,
    { method: 'PUT', headers, body: JSON.stringify(body) },
  );
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}
