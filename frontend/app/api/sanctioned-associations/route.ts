import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

export async function GET(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const includeInactive = request.nextUrl.searchParams.get('include_inactive');
  const url = `${API_URL}/sanctioned-associations/${
    includeInactive ? `?include_inactive=${includeInactive}` : ''
  }`;
  const { json, status } = await safeFetchBackend(url, { headers, cache: 'no-store' });
  return NextResponse.json(json, { status });
}

export async function POST(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json();
  const { json, status } = await safeFetchBackend(`${API_URL}/sanctioned-associations/`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return NextResponse.json(json, { status });
}
