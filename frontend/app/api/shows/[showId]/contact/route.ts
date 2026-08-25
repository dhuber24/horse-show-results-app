import { NextRequest, NextResponse } from 'next/server';
import { API_URL, getAuthHeaders, safeFetchBackend } from '@/lib/backend-fetch';

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

// No session required — the whole point of the contact form is that the sender
// may not have an account. The internal API key still gates the backend, and
// the backend rate-limits this endpoint.
//
// A session, where there is one, is forwarded so the backend can stamp the
// message with who sent it. That is the only way the show office can tell a
// question from one of their entrants apart from one from a stranger; asking
// the sender to type their back number would be a self-reported answer to an
// identity question. The body is never trusted for this — see the backend.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ showId: string }> },
) {
  const { showId } = await params;
  const body = await request.json();
  const authHeaders = await getAuthHeaders();

  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/contact/`, {
    method: 'POST',
    headers: authHeaders ?? { 'Content-Type': 'application/json', 'X-API-Key': INTERNAL_API_KEY },
    body: JSON.stringify(body),
  });
  return NextResponse.json(json, { status });
}
