import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ entryId: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { entryId } = await params;
  const body = await request.json();
  const { showId, classId, ...data } = body;

  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/classes/${classId}/entries/${entryId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(data),
  });
  return NextResponse.json(json, { status });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ entryId: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { entryId } = await params;
  const { searchParams } = new URL(request.url);
  const showId = searchParams.get('showId');
  const classId = searchParams.get('classId');

  if (!showId || !classId) {
    return NextResponse.json({ error: 'showId and classId are required' }, { status: 400 });
  }

  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/classes/${classId}/entries/${entryId}`, {
    method: 'DELETE',
    headers,
  });

  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}
