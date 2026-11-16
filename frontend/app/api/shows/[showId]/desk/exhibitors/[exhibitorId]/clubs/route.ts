import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** The desk sets which saddle club(s) a rider rides for at this show. */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ showId: string; exhibitorId: string }> },
) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId, exhibitorId } = await params;
  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/desk/exhibitors/${exhibitorId}/clubs`, {
    method: 'PUT',
    headers,
    body: await req.text(),
  });
  return NextResponse.json(json, { status });
}
