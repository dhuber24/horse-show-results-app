import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** A show's stall periods (migration 194), as the office edits them. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId } = await params;
  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/stall-periods`, {
    headers,
    cache: 'no-store',
  });
  return NextResponse.json(json, { status });
}

/** Replaces the whole list, in order; a period left out is deleted. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId } = await params;
  const body = await request.json();
  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/stall-periods`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  return NextResponse.json(json, { status });
}
