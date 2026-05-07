import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; regId: string }> },
) {
  const { id, regId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const res = await fetch(`${API_URL}/exhibitors/${id}/registrations/${regId}`, {
    method: 'DELETE',
    headers,
  });
  if (res.status === 204) return new NextResponse(null, { status: 204 });
  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}
