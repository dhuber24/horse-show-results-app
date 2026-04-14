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

  // Check if a rider with this name already exists and is unlinked
  const ridersRes = await fetch(`${API_URL}/riders/`);
  const riders = await ridersRes.json();
  const existing = riders.find(
    (r: any) => r.full_name.toLowerCase() === body.full_name.toLowerCase() && !r.user_id
  );

  if (existing) {
    // Link existing rider to new user
    await fetch(`${API_URL}/riders/${existing.id}/link`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.id }),
    });
  } else {
    // Create new rider record
    await fetch(`${API_URL}/riders/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: body.full_name, user_id: user.id }),
    });
  }

  return NextResponse.json(user);
}
