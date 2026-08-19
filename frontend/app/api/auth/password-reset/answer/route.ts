import { NextRequest, NextResponse } from 'next/server';
import { API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Answer + new password in one request. Public for the same reason as the
 * question lookup; the throttling that makes that safe lives on the backend,
 * counted against the account rather than this handler.
 */
export async function POST(request: NextRequest) {
  const body = await request.json();

  const { json, status } = await safeFetchBackend(`${API_URL}/auth/password-reset/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (status >= 400) {
    return NextResponse.json({ error: json?.detail || 'Failed to reset password.' }, { status });
  }
  return NextResponse.json(json, { status });
}
