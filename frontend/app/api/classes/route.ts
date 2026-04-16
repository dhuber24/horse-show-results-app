import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

export async function POST(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { showId, ...data } = body;
  const res = await fetch(`${API_URL}/shows/${showId}/classes/`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}

export async function PATCH(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { showId, classId, ...data } = body;
  const res = await fetch(`${API_URL}/shows/${showId}/classes/${classId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(data),
  });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}

export async function DELETE(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { showId, classId } = await request.json();
  const res = await fetch(`${API_URL}/shows/${showId}/classes/${classId}`, {
    method: 'DELETE',
    headers,
  });
  if (res.status === 204) return new NextResponse(null, { status: 204 });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
