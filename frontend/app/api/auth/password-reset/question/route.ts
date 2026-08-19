import { NextRequest, NextResponse } from 'next/server';
import { API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Public by necessity — the caller is someone who cannot sign in. Passes the
 * backend's status through untouched: 404 (no question on file) and 429 (locked
 * out or rate limited) are both things the form renders differently.
 */
export async function POST(request: NextRequest) {
  const body = await request.json();

  const { json, status } = await safeFetchBackend(`${API_URL}/auth/password-reset/question`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (status >= 400) {
    return NextResponse.json({ error: json?.detail || 'Could not look up that account.' }, { status });
  }
  return NextResponse.json(json, { status });
}
