import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * The judge registry — the source of truth for a judge's details and the
 * associations they are carded with. Show setup picks from this list.
 */
export async function GET(req: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const suffix =
    req.nextUrl.searchParams.get('include_inactive') === 'true'
      ? '?include_inactive=true'
      : '';
  const { json, status } = await safeFetchBackend(`${API_URL}/judges/${suffix}`, { headers, cache: 'no-store' });
  return NextResponse.json(json, { status });
}

export async function POST(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json();
  const { json, status } = await safeFetchBackend(`${API_URL}/judges/`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return NextResponse.json(json, { status });
}
