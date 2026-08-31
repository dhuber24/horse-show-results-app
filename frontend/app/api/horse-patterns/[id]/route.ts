import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const { json, status } = await safeFetchBackend(`${API_URL}/horse-patterns/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  return NextResponse.json(json, { status });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const { json, status } = await safeFetchBackend(`${API_URL}/horse-patterns/${id}`, { method: 'DELETE', headers });
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}
