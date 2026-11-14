import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

type Params = { params: Promise<{ showId: string; checkId: string }> };

/** Accept a check read off the show bill (migration 187): somebody looked, and
 *  it is right as it stands. */
export async function PUT(_req: NextRequest, { params }: Params) {
  return forward('PUT', await params);
}

/** Take an acceptance back. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  return forward('DELETE', await params);
}

async function forward(method: 'PUT' | 'DELETE', { showId, checkId }: { showId: string; checkId: string }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/bill-checks/${encodeURIComponent(checkId)}/accepted`,
    { method, headers },
  );
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}
