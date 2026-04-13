import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL || 'http://backend:8000';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { showId, classId, ...data } = body;
  const res = await fetch(`${API_URL}/shows/${showId}/classes/${classId}/results/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { showId, classId, resultId, ...data } = body;
  const res = await fetch(`${API_URL}/shows/${showId}/classes/${classId}/results/${resultId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
