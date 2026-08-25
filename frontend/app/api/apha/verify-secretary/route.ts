import { NextRequest, NextResponse } from 'next/server';
import { safeFetchBackend } from '@/lib/backend-fetch';

const API_URL = process.env.API_URL || 'http://backend:8000';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.trim();
  if (!email) {
    return NextResponse.json({ error: 'email parameter required' }, { status: 400 });
  }

  const url = `${API_URL}/certifications/verify?email=${encodeURIComponent(email)}&org=APHA`;
  // safeFetchBackend absorbs the network and parse failures the try/catch used
  // to cover, reporting them through `error` instead of throwing.
  const { json, status, error } = await safeFetchBackend(url, {
    headers: { 'X-API-Key': INTERNAL_API_KEY },
    cache: 'no-store',
  });

  if (error || status >= 400) {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 });
  }

  return NextResponse.json(json);
}
