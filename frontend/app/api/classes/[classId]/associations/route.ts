import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

export async function GET(request: NextRequest, { params }: { params: Promise<{ classId: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { classId } = await params;
  const { searchParams } = new URL(request.url);
  const showId = searchParams.get('showId');
  if (!showId) return NextResponse.json({ error: 'showId is required' }, { status: 400 });

  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/classes/${classId}/associations`, { headers });
  return NextResponse.json(json, { status });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ classId: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { classId } = await params;
  const body = await request.json();
  const { showId, ...data } = body;

  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/classes/${classId}/associations`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  return NextResponse.json(json, { status });
}
