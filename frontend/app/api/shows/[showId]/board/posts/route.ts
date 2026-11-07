import { NextRequest, NextResponse } from 'next/server';
import { API_URL, getAuthHeaders, safeFetchBackend } from '@/lib/backend-fetch';

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

// Post to a show's board, or reply. No session required — a visitor posts as
// "Visitor". A session, where there is one, is forwarded and is the only thing
// that decides the poster's name and badge: the body carries the words, the
// category and the anonymous tick, never an identity.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ showId: string }> },
) {
  const { showId } = await params;
  const body = await request.json().catch(() => ({}));
  const authHeaders = await getAuthHeaders();

  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/board/posts`, {
    method: 'POST',
    headers: authHeaders ?? { 'Content-Type': 'application/json', 'X-API-Key': INTERNAL_API_KEY },
    body: JSON.stringify(body),
  });
  return NextResponse.json(json, { status });
}
