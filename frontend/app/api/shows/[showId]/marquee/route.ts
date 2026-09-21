import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * What the live screens' marquee carries — set from the Results Board page.
 *
 * Only the write comes through here. The board's server page reads the
 * marquee straight from the backend on its poll, like the results beside it.
 * The backend's 422s (a message mode with nothing typed, a message over the
 * limit) are passed straight through so the page can print the reason.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/marquee`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  return NextResponse.json(json, { status });
}
