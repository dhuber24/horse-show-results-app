import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ showId: string }> },
) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId } = await params;
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/side-pots/`,
    { headers },
  );
  return NextResponse.json(json, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ showId: string }> },
) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId } = await params;
  const body = await request.json();
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/side-pots/`,
    { method: 'POST', headers, body: JSON.stringify(body) },
  );
  return NextResponse.json(json, { status });
}
