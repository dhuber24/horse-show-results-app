import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

type Ctx = { params: Promise<{ showId: string; futurityId: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId, futurityId } = await params;
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/futurities/${futurityId}/entries`,
    { headers },
  );
  return NextResponse.json(json, { status });
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId, futurityId } = await params;
  const body = await request.json();
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/futurities/${futurityId}/entries`,
    { method: 'POST', headers, body: JSON.stringify(body) },
  );
  return NextResponse.json(json, { status });
}
