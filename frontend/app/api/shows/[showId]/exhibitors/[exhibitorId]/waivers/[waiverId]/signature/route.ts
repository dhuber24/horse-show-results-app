import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

type Params = { showId: string; exhibitorId: string; waiverId: string };

/** Staff recording a blank signed on paper at the counter. */
export async function POST(req: NextRequest, { params }: { params: Promise<Params> }) {
  const { showId, exhibitorId, waiverId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/exhibitors/${exhibitorId}/waivers/${waiverId}/signature`,
    { method: 'POST', headers, body: JSON.stringify(body) },
  );
  return NextResponse.json(json, { status });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<Params> }) {
  const { showId, exhibitorId, waiverId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/exhibitors/${exhibitorId}/waivers/${waiverId}/signature`,
    { method: 'DELETE', headers },
  );
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}
