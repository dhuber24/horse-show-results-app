import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL || 'http://backend:8000';

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { showId, assignments } = body;
  const res = await fetch(`${API_URL}/shows/${showId}/back-numbers/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignments }),
  });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { showId } = body;
  const res = await fetch(`${API_URL}/shows/${showId}/back-numbers/auto-assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
