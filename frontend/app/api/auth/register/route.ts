import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL || 'http://backend:8000';

export async function POST(request: NextRequest) {
  const body = await request.json();

  const userRes = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!userRes.ok) {
    const json = await userRes.json();
    return NextResponse.json({ error: json.detail || 'Registration failed' }, { status: userRes.status });
  }

  const user = await userRes.json();
  return NextResponse.json(user);
}
