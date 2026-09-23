import { NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** People who are on file more than once, grouped by the reason to suspect it. */
export async function GET() {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(`${API_URL}/exhibitors/duplicates`, {
    headers,
    cache: 'no-store',
  });
  return NextResponse.json(json, { status });
}
