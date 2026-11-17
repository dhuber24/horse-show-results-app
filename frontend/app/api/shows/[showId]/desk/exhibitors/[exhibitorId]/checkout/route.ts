import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Check an exhibitor out at the desk (migration 200), or undo it.
 *
 * The office's last step with somebody leaving: the stalls looked over, any
 * charge still owed added (`/api/shows/[showId]/adjustments`), the balance
 * settled, and then this — when, and by whom. A record, never a gate.
 */
async function relay(method: 'POST' | 'DELETE', params: Promise<{ showId: string; exhibitorId: string }>) {
  const { showId, exhibitorId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/desk/exhibitors/${exhibitorId}/checkout`,
    { method, headers },
  );
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ showId: string; exhibitorId: string }> },
) {
  return relay('POST', params);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ showId: string; exhibitorId: string }> },
) {
  return relay('DELETE', params);
}
