import { NextRequest, NextResponse } from 'next/server';
import { API_URL } from '@/lib/backend-fetch';

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

// Public-ish: invitee accepting their invite is not signed in yet.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = await request.json();
  const res = await fetch(
    `${API_URL}/user-invites/by-token/${encodeURIComponent(token)}/accept`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': INTERNAL_API_KEY,
      },
      body: JSON.stringify(body),
    },
  );
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
