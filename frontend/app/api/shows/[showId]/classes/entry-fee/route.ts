import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** Price a group of classes at one amount — the Show Fees step's class prices. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/classes/entry-fee`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return NextResponse.json(json, { status });
}
