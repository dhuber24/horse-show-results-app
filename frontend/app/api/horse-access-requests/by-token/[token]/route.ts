import { NextRequest, NextResponse } from 'next/server';
import { API_URL } from '@/lib/backend-fetch';

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

// Public-ish: no NextAuth session required. The person approving may never
// have signed in — a horse can be transferred to someone whose first contact
// with the app is this link. The token is the authorization; the internal API
// key still gates the backend.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const res = await fetch(
    `${API_URL}/horse-access-requests/by-token/${encodeURIComponent(token)}`,
    {
      headers: { 'Content-Type': 'application/json', 'X-API-Key': INTERNAL_API_KEY },
      cache: 'no-store',
    },
  );
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
