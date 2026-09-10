import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * The bookmark for a registration somebody has started (migration 136).
 *
 * `POST` is fired by the registration screen when it opens, so that a show
 * abandoned before sign-up still appears on My Shows — the first three steps of
 * the wizard write the exhibitor's own profile and nothing against the show, so
 * without this there is no record anywhere that they were part-way through.
 * `DELETE` is the "not entering this show" dismiss on the My Shows card.
 *
 * Both derive the exhibitor from the session; there is nothing in either
 * request saying who is asking.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/register/draft`, {
    method: 'POST',
    headers,
  });
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/register/draft`, {
    method: 'DELETE',
    headers,
  });
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}
