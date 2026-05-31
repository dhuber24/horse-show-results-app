import { NextRequest, NextResponse } from 'next/server';
import { API_URL } from '@/lib/backend-fetch';

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

// Public-ish: no NextAuth session required (invitee isn't logged in).
// The internal API key still gates the backend.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const res = await fetch(`${API_URL}/user-invites/by-token/${encodeURIComponent(token)}`, {
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': INTERNAL_API_KEY,
    },
    cache: 'no-store',
  });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
