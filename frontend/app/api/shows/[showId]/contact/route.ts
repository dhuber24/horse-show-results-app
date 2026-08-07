import { NextRequest, NextResponse } from 'next/server';
import { API_URL } from '@/lib/backend-fetch';

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

// Public: no NextAuth session required. The whole point of the contact form is
// that the sender does not have an account yet. The internal API key still
// gates the backend, and the backend rate-limits this endpoint.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ showId: string }> },
) {
  const { showId } = await params;
  const body = await request.json();

  const res = await fetch(`${API_URL}/shows/${showId}/contact/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': INTERNAL_API_KEY },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}
