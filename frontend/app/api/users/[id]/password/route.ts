import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const res = await fetch(`${API_URL}/users/${id}/password`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  if (res.status === 204) return new NextResponse(null, { status: 204 });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
