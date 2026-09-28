import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** Count a show toward the circuit. The owner, working that show. */
export async function PUT(_req: NextRequest, { params }: { params: Promise<{ id: string; showId: string }> }) {
  const { id, showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(`${API_URL}/circuits/${id}/shows/${showId}`, {
    method: 'PUT',
    headers,
  });
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}

/** Take a show out of the circuit. The owner, or the show's own office. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; showId: string }> }) {
  const { id, showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(`${API_URL}/circuits/${id}/shows/${showId}`, {
    method: 'DELETE',
    headers,
  });
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}
