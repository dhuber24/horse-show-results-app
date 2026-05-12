import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

export async function GET() {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const res = await fetch(`${API_URL}/trainers/me`, { headers, cache: 'no-store' });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}

export async function PATCH(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const res = await fetch(`${API_URL}/trainers/me`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
