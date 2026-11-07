import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Putting a show's stall map or RV map on file, and taking it off (migration
 * 182). `kind` is `stall` or `rv`; the backend refuses anything else.
 *
 * Which maps a show has is public and read straight from the backend by the
 * page; only the two writes need a session, so only they are here.
 */

type Params = { params: Promise<{ showId: string; kind: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { showId, kind } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await req.formData();
  // Drop Content-Type so fetch sets it with the multipart boundary.
  const { 'Content-Type': _ct, ...forwardHeaders } = headers as Record<string, string>;

  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/maps/${encodeURIComponent(kind)}`,
    { method: 'POST', headers: forwardHeaders, body: formData },
  );
  return NextResponse.json(json, { status });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { showId, kind } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/maps/${encodeURIComponent(kind)}`,
    { method: 'DELETE', headers },
  );
  return NextResponse.json(json, { status });
}
