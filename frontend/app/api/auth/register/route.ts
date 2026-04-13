import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL || 'http://backend:8000';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, role: 'RIDER' }),
  });
  const json = await res.json();
  if (!res.ok) {
    return NextResponse.json({ error: json.detail || 'Registration failed' }, { status: res.status });
  }
  return NextResponse.json(json);
}
