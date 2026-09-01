import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/register/signup`, {
    headers,
    cache: 'no-store',
  });
  return NextResponse.json(json, { status });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/register/signup`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  return NextResponse.json(json, { status });
}

/**
 * Cancel this show registration.
 *
 * Refused by the backend inside the two-week notice window, with
 * `CANCELLATION_WINDOW_CLOSED` and the deadline on it — the status is passed
 * through untouched so the screen can print the office's answer rather than a
 * generic failure.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // A cancellation reason is optional, and a DELETE with no body is normal.
  const body = await request.json().catch(() => ({}));
  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/register/signup`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify(body ?? {}),
  });
  return NextResponse.json(json, { status });
}
