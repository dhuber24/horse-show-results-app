import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

export async function GET(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const statusFilter = request.nextUrl.searchParams.get('status');
  const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
  const { json, status } = await safeFetchBackend(`${API_URL}/horse-access-requests/${qs}`, {
    headers,
    cache: 'no-store',
  });
  return NextResponse.json(json, { status });
}

export async function POST(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { json, status } = await safeFetchBackend(`${API_URL}/horse-access-requests/`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return NextResponse.json(json, { status });
}
