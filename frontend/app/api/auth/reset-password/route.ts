import { NextRequest, NextResponse } from 'next/server';
import { safeFetchBackend } from '@/lib/backend-fetch';

const API_URL = process.env.API_URL || 'http://backend:8000';

export async function POST(request: NextRequest) {
  const body = await request.json();

  const { json, status } = await safeFetchBackend(`${API_URL}/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (status >= 400) {
    return NextResponse.json({ error: json?.detail || 'Failed to reset password' }, { status });
  }
  return NextResponse.json(json);
}
