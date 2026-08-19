import { NextRequest, NextResponse } from 'next/server';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

// The session is forwarded when there is one, and the request goes through
// either way: the backend answers an anonymous caller with a 401 carrying
// SIGN_IN_REQUIRED, which is what the page renders its "sign in to answer"
// branch from. Deciding here instead would put the same rule in two places.
//
// The token no longer authorizes anything on its own — it is handed to the
// *requester* so an undelivered email can't strand a horse, which is exactly
// why possessing it cannot be the permission. See the backend module docstring.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const authHeaders = await getAuthHeaders();
  const res = await fetch(
    `${API_URL}/horse-access-requests/by-token/${encodeURIComponent(token)}`,
    {
      headers: authHeaders ?? { 'Content-Type': 'application/json', 'X-API-Key': INTERNAL_API_KEY },
      cache: 'no-store',
    },
  );
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
