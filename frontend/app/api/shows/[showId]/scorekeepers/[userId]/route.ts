import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ showId: string; userId: string }> },
) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId, userId } = await params;
  const res = await fetch(`${API_URL}/shows/${showId}/scorekeepers/${userId}`, {
    method: 'DELETE',
    headers,
  });
  if (res.status === 204) return new NextResponse(null, { status: 204 });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
