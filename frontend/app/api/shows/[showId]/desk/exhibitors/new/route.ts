import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Create an exhibitor the app has never seen and put them on this show.
 *
 * Distinct from `POST .../desk/exhibitors`, which adds somebody who already has
 * a record. This one makes the record — a name, and whatever else was on the
 * paper entry blank. No account is created: a login belongs to the person who
 * will sign in to it.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ showId: string }> },
) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/desk/exhibitors/new`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return NextResponse.json(json, { status });
}
