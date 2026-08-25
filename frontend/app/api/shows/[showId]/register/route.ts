import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, safeFetchBackend, API_URL } from '@/lib/backend-fetch';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/register/preview`,
    { headers },
  );
  return NextResponse.json(json, { status });
}

/**
 * Enter classes. The body is a list because the endpoint has always taken one,
 * but the registration screen now posts a single entry per press — so a 500
 * here is one class failing in front of someone who just clicked, not a whole
 * batch. `safeFetchBackend` is what keeps that arriving as the backend's status
 * instead of an opaque JSON parse error.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/register/`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return NextResponse.json(json, { status });
}
