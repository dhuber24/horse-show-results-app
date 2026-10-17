import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** Mark a Pro+ year paid (migration 171). ADMIN only. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; subscriptionId: string }> }) {
  const { id, subscriptionId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(`${API_URL}/show-companies/${id}/subscriptions/${subscriptionId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(await req.json()),
  });
  return NextResponse.json(json, { status });
}

/** Remove a Pro+ year recorded in error. ADMIN only. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; subscriptionId: string }> }) {
  const { id, subscriptionId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(`${API_URL}/show-companies/${id}/subscriptions/${subscriptionId}`, {
    method: 'DELETE',
    headers,
  });
  return NextResponse.json(json, { status });
}
