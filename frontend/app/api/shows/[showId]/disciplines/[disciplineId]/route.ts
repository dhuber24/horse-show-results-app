import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ showId: string; disciplineId: string }> },
) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId, disciplineId } = await params;
  const body = await request.json();
  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/disciplines/${disciplineId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  return NextResponse.json(json, { status });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ showId: string; disciplineId: string }> },
) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId, disciplineId } = await params;
  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/disciplines/${disciplineId}`, {
    method: 'DELETE',
    headers,
  });
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}
