import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ showId: string }> },
) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const res = await fetch(`${API_URL}/user-invites/by-show/${showId}`, {
    headers,
    cache: 'no-store',
  });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
