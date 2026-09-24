import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Show companies — the business a paid feature is switched on for
 * (migration 142). GaitDesk admin only on the backend.
 */
export async function GET(req: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = req.nextUrl.searchParams.get('user_id');
  const suffix = userId ? `?user_id=${encodeURIComponent(userId)}` : '';
  const { json, status } = await safeFetchBackend(`${API_URL}/show-companies/${suffix}`, {
    headers,
    cache: 'no-store',
  });
  return NextResponse.json(json, { status });
}

export async function POST(req: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  const { json, status } = await safeFetchBackend(`${API_URL}/show-companies/`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return NextResponse.json(json, { status });
}
