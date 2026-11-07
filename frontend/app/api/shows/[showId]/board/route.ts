import { NextRequest, NextResponse } from 'next/server';
import { API_URL, getAuthHeaders, safeFetchBackend } from '@/lib/backend-fetch';

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

// The show's discussion board (migration 183). Public, like the Contact form:
// no session is needed to read it. A session, where there is one, is forwarded
// so the backend can say whether the reader may post, who they would post as,
// and — for the show office — show them the posts it has hidden.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ showId: string }> },
) {
  const { showId } = await params;
  const query = new URLSearchParams();
  const before = request.nextUrl.searchParams.get('before');
  const withViewer = request.nextUrl.searchParams.get('with_viewer');
  if (before) query.set('before', before);
  if (withViewer) query.set('with_viewer', withViewer);

  const authHeaders = await getAuthHeaders();
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/board${query.size ? `?${query}` : ''}`,
    {
      headers: authHeaders ?? { 'Content-Type': 'application/json', 'X-API-Key': INTERNAL_API_KEY },
      cache: 'no-store',
    },
  );
  return NextResponse.json(json, { status });
}
