import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL || 'http://backend:8000';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

const internalHeaders = {
  'Content-Type': 'application/json',
  'X-API-Key': INTERNAL_API_KEY,
  'X-User-Role': 'ADMIN',
  'X-User-Id': '00000000-0000-0000-0000-000000000000',
};

export async function POST(request: NextRequest) {
  const body = await request.json();

  // Create user
  const userRes = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, role: 'EXHIBITOR' }),
  });

  if (!userRes.ok) {
    const json = await userRes.json();
    return NextResponse.json({ error: json.detail || 'Registration failed' }, { status: userRes.status });
  }

  const user = await userRes.json();

  // Check if an exhibitor with this name already exists and is unlinked
  try {
    const exhibitorsRes = await fetch(`${API_URL}/exhibitors/`, { headers: internalHeaders });
    if (exhibitorsRes.ok) {
      const exhibitors = await exhibitorsRes.json();
      const existing = Array.isArray(exhibitors)
        ? exhibitors.find((r: any) => r.full_name.toLowerCase() === body.full_name.toLowerCase() && !r.user_id)
        : null;

      if (existing) {
        // Link existing exhibitor to new user
        await fetch(`${API_URL}/exhibitors/${existing.id}/link`, {
          method: 'PATCH',
          headers: internalHeaders,
          body: JSON.stringify({ user_id: user.id }),
        });
      } else {
        // Create new exhibitor record
        await fetch(`${API_URL}/exhibitors/`, {
          method: 'POST',
          headers: internalHeaders,
          body: JSON.stringify({ full_name: body.full_name, user_id: user.id }),
        });
      }
    } else {
      // Fallback: just create a new exhibitor record
      await fetch(`${API_URL}/exhibitors/`, {
        method: 'POST',
        headers: internalHeaders,
        body: JSON.stringify({ full_name: body.full_name, user_id: user.id }),
      });
    }
  } catch {
    // Non-fatal: user account was created; exhibitor linking failed silently
  }

  return NextResponse.json(user);
}
