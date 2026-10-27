import { NextRequest, NextResponse } from 'next/server';
import { safeFetchBackend } from '@/lib/backend-fetch';
import { errorMessage } from '@/lib/api-error';

const API_URL = process.env.API_URL || 'http://backend:8000';

export async function POST(request: NextRequest) {
  const body = await request.json();

  const { json, status } = await safeFetchBackend(`${API_URL}/auth/register/show-secretary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (status >= 400) {
    // A malformed email is a Pydantic 422, whose `detail` is a list --
    // flattened here so the form can print it.
    return NextResponse.json({ error: errorMessage(json, 'Registration failed') }, { status });
  }

  return NextResponse.json(json);
}
