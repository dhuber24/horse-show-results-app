import { NextRequest, NextResponse } from 'next/server';
import { signIn } from 'next-auth/react';

const API_URL = process.env.API_URL || 'http://backend:8000';

export async function POST(request: NextRequest) {
  const body = await request.json();

  const res = await fetch(`${API_URL}/auth/register/show-secretary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok) {
    return NextResponse.json({ error: json.detail || 'Registration failed' }, { status: res.status });
  }

  return NextResponse.json(json);
}
