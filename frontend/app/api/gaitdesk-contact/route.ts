import { NextRequest, NextResponse } from 'next/server';
import { API_URL, getAuthHeaders, safeFetchBackend } from '@/lib/backend-fetch';

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

// Send GaitDesk a message (`/contact`). No session required — a club that has
// not signed up yet is who this is for — and the backend rate-limits it. A
// session, where there is one, is forwarded so the backend can stamp who sent
// it; the body is never trusted for that. Same shape as a show's own contact
// route, `api/shows/[showId]/contact`.
export async function POST(request: NextRequest) {
  const body = await request.json();
  const authHeaders = await getAuthHeaders();

  const { json, status } = await safeFetchBackend(`${API_URL}/gaitdesk-contact/`, {
    method: 'POST',
    headers: authHeaders ?? { 'Content-Type': 'application/json', 'X-API-Key': INTERNAL_API_KEY },
    body: JSON.stringify(body),
  });
  return NextResponse.json(json, { status });
}
