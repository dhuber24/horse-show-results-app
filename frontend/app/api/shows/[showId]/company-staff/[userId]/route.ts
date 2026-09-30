import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** Take somebody out of the show's company, and so off every show it runs. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ showId: string; userId: string }> },
) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId, userId } = await params;
  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/company-staff/${userId}`, {
    method: 'DELETE',
    headers,
  });
  return NextResponse.json(json, { status });
}
