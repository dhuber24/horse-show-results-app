import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

export async function GET(request: NextRequest, { params }: { params: Promise<{ classId: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { classId } = await params;
  const { searchParams } = new URL(request.url);
  const showId = searchParams.get('showId');
  if (!showId) return NextResponse.json({ error: 'showId is required' }, { status: 400 });

  const res = await fetch(`${API_URL}/shows/${showId}/classes/${classId}/associations`, { headers });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ classId: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { classId } = await params;
  const body = await request.json();
  const { showId, ...data } = body;

  const res = await fetch(`${API_URL}/shows/${showId}/classes/${classId}/associations`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
