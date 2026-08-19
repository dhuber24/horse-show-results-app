import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId } = await params;
  const { status, json } = await safeFetchBackend(`${API_URL}/shows/${showId}/managers`, {
    headers,
    cache: 'no-store',
  });
  return NextResponse.json(json, { status });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId } = await params;
  const body = await request.json();
  const { status, json } = await safeFetchBackend(`${API_URL}/shows/${showId}/managers`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return NextResponse.json(json, { status });
}
