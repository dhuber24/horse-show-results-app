import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Decline somebody who asked to join a show company at sign-up (migration
 * 143). Approving is adding them as a member, through `../../members`.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const { id, userId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { json, status } = await safeFetchBackend(`${API_URL}/show-companies/${id}/join-requests/${userId}`, {
    method: 'DELETE',
    headers,
  });
  return NextResponse.json(json, { status });
}
