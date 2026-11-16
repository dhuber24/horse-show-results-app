import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** The show office adds a saddle club that is not listed, kept for every show after. */
export async function POST(req: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { json, status } = await safeFetchBackend(`${API_URL}/saddle-clubs`, {
    method: 'POST',
    headers,
    body: await req.text(),
  });
  return NextResponse.json(json, { status });
}
