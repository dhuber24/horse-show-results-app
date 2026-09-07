import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Editing a registry judge. Admin-only on the backend, because the record is
 * shared by every show that judge has ever worked — a correction here reaches
 * all of them, which is the point.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await request.json();
  const { json, status } = await safeFetchBackend(`${API_URL}/judges/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  return NextResponse.json(json, { status });
}
