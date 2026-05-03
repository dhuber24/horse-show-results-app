import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL || 'http://backend:8000';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.trim();
  if (!email) {
    return NextResponse.json({ error: 'email parameter required' }, { status: 400 });
  }

  try {
    const url = `${API_URL}/certifications/verify?email=${encodeURIComponent(email)}&org=APHA`;
    const res = await fetch(url, {
      headers: { 'X-API-Key': INTERNAL_API_KEY },
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'Lookup failed' }, { status: 502 });
    }

    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 });
  }
}
