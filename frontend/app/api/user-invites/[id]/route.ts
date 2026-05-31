import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const res = await fetch(`${API_URL}/user-invites/${id}`, {
    method: 'DELETE',
    headers,
  });
  if (res.status === 204) return new NextResponse(null, { status: 204 });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
