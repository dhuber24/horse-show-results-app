import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL || 'http://backend:8000';

export async function POST(request: NextRequest) {
  const body = await request.json();

  // Create user
  const userRes = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, role: 'RIDER' }),
  });

  if (!userRes.ok) {
    const json = await userRes.json();
    return NextResponse.json({ error: json.detail || 'Registration failed' }, { status: userRes.status });
  }

  const user = await userRes.json();

  // Create linked rider record
  await fetch(`${API_URL}/riders/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name: body.full_name, user_id: user.id }),
  });

  return NextResponse.json(user);
}
