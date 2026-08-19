import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Record a payment the show office collected.
 *
 * The staff member is identified by the auth headers, not the body — the
 * backend reads `recorded_by` off the caller so a client cannot attribute a
 * payment to someone else.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/payments`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return NextResponse.json(json, { status });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/payments`, {
    headers,
    cache: 'no-store',
  });
  return NextResponse.json(json, { status });
}
