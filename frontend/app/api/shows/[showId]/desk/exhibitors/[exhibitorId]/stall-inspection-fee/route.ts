import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * The stall inspection fee box at checkout (migration 209): PUT puts the
 * show's fee on the exhibitor's bill, DELETE takes it off. The amount is the
 * show's, set on the Lodging step — never sent from here.
 */
async function relay(method: 'PUT' | 'DELETE', params: Promise<{ showId: string; exhibitorId: string }>) {
  const { showId, exhibitorId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/desk/exhibitors/${exhibitorId}/stall-inspection-fee`,
    { method, headers },
  );
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}

export async function PUT(
  _request: NextRequest,
  { params }: { params: Promise<{ showId: string; exhibitorId: string }> },
) {
  return relay('PUT', params);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ showId: string; exhibitorId: string }> },
) {
  return relay('DELETE', params);
}
