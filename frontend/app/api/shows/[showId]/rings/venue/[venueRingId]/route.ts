import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** Take a ring no show runs off the venue's list (migration 204). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ showId: string; venueRingId: string }> },
) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId, venueRingId } = await params;
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/rings/venue/${venueRingId}`,
    { method: 'DELETE', headers },
  );
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}
