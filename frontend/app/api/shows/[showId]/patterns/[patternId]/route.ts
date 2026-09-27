import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

type Params = { params: Promise<{ showId: string; patternId: string }> };

/** Renaming a pattern or changing its notes. The file has its own handler. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { showId, patternId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/patterns/${patternId}`,
    { method: 'PATCH', headers, body: JSON.stringify(body) },
  );
  return NextResponse.json(json, { status });
}

/** Taking a pattern off file. Its classes go back to having none. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { showId, patternId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/patterns/${patternId}`,
    { method: 'DELETE', headers },
  );
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}
