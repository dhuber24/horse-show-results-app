import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId } = await params;
  const res = await fetch(`${API_URL}/shows/${showId}/admins`, { headers });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId } = await params;
  const body = await request.json();
  const res = await fetch(`${API_URL}/shows/${showId}/admins`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
