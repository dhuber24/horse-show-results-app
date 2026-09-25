import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * The details step of one show's registration — contact details, date of
 * birth, emergency contact.
 *
 * Saved against this show only (migration 145). It used to be
 * `PATCH /exhibitors/{id}`, which rewrote the exhibitor's profile for every
 * show; the profile now only prefills the form. The backend derives the
 * exhibitor from the session.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ showId: string }> },
) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/register/details`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  return NextResponse.json(json, { status });
}
