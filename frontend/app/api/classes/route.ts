import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

export async function POST(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { showId, ...data } = body;
  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/classes/`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  return NextResponse.json(json, { status });
}

export async function PATCH(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { showId, classId, ...data } = body;
  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/classes/${classId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(data),
  });
  return NextResponse.json(json, { status });
}

export async function DELETE(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { showId, classId } = await request.json();
  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/classes/${classId}`, {
    method: 'DELETE',
    headers,
  });
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}
