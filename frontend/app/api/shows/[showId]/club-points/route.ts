import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** The show's saddle-club high point setup (migration 193). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId } = await params;
  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/club-points`, { headers });
  return NextResponse.json(json, { status });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId } = await params;
  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/club-points`, {
    method: 'PUT',
    headers,
    body: await req.text(),
  });
  return NextResponse.json(json, { status });
}
