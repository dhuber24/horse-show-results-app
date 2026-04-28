import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

export async function GET() {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const res = await fetch(`${API_URL}/users/me`, { headers, cache: 'no-store' });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}

export async function PATCH(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const res = await fetch(`${API_URL}/users/me`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
