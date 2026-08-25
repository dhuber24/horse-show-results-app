import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

export async function PATCH(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { showId, assignments } = body;
  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/back-numbers/`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ assignments }),
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
