import { NextRequest, NextResponse } from 'next/server';
import { API_URL } from '@/lib/backend-fetch';

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

// Public-ish, same reasoning as the GET alongside it: the token carries the
// authorization for exactly one decision about one horse.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = await request.json();
  const res = await fetch(
    `${API_URL}/horse-access-requests/by-token/${encodeURIComponent(token)}/respond`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': INTERNAL_API_KEY },
      body: JSON.stringify(body),
    },
  );
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
