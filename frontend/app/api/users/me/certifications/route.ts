import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * The associations the signed-in user says they are carded with.
 *
 * Written by the post-signup questionnaire, which is why this is a session
 * endpoint rather than part of the registration body: the questions are asked
 * after the account exists, so the association list behind them can be fetched
 * at all. The registration screens used to render the picker before sign-in,
 * against `/api/associations` — which requires a session and answered 401, so
 * the list was empty for every new registrant it was shown to.
 */
export async function GET() {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(`${API_URL}/users/me/certifications`, {
    headers,
    cache: 'no-store',
  });
  return NextResponse.json(json, { status });
}

export async function PUT(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { json, status } = await safeFetchBackend(`${API_URL}/users/me/certifications`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  return NextResponse.json(json, { status });
}
