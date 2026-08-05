import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const res = await fetch(`${API_URL}/shows/${showId}/register/signup`, {
    headers,
    cache: 'no-store',
  });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const res = await fetch(`${API_URL}/shows/${showId}/register/signup`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
