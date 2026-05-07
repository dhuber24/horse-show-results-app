import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; horseId: string }> },
) {
  const { id, horseId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const res = await fetch(`${API_URL}/exhibitors/${id}/created-horses/${horseId}`, {
    method: 'DELETE',
    headers,
  });
  if (res.status === 204) return new NextResponse(null, { status: 204 });
  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}
