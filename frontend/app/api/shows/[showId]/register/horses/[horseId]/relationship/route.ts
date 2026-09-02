import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * How the signed-in exhibitor is entitled to show one of their own horses.
 *
 * Asked once, on the wizard's horses step, and copied onto every entry from
 * there — the entry form used to ask it per class from a list of twenty-five.
 * The backend derives which exhibitor this is from the session and refuses a
 * horse that is not on their profile, so nothing in the path says who is
 * asking.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ showId: string; horseId: string }> },
) {
  const { showId, horseId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/register/horses/${horseId}/relationship`,
    { method: 'PUT', headers, body: JSON.stringify(body) },
  );
  return NextResponse.json(json, { status });
}
