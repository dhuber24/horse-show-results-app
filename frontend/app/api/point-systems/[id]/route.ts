import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** Replace a points system's name and chart. ADMIN only. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(`${API_URL}/point-systems/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(await req.json()),
  });
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}

/** Refused with 409 POINT_SYSTEM_IN_USE while a show or circuit uses it. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(`${API_URL}/point-systems/${id}`, {
    method: 'DELETE',
    headers,
  });
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}
