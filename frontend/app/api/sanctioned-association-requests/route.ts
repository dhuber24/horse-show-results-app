import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

export async function GET(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const status = request.nextUrl.searchParams.get('status');
  const url = `${API_URL}/sanctioned-association-requests/${
    status ? `?status=${encodeURIComponent(status)}` : ''
  }`;
  const res = await fetch(url, { headers, cache: 'no-store' });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}

export async function POST(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json();
  const res = await fetch(`${API_URL}/sanctioned-association-requests/`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
