import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

export async function PATCH(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { showId, assignments, horses } = body;
  // `horses` is a show that numbers horses or pairs (migrations 161, 178): one
  // number per horse rather than per exhibitor, on its own endpoint. At a pair
  // show each carries the `exhibitor_id` whose number it is.
  const url = horses
    ? `${API_URL}/shows/${showId}/back-numbers/horses`
    : `${API_URL}/shows/${showId}/back-numbers/`;
  const { json, status } = await safeFetchBackend(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ assignments: horses ?? assignments }),
  });
  return NextResponse.json(json, { status });
}

export async function POST(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { showId } = body;
  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/back-numbers/auto-assign`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  return NextResponse.json(json, { status });
}
