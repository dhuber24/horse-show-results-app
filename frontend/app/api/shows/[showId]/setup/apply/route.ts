import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ showId: string }> },
) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId } = await params;
  const body = await request.json();
  const res = await fetch(`${API_URL}/shows/${showId}/setup/apply`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const json = res.status === 204 ? null : await res.json();
  return NextResponse.json(json, { status: res.status });
}
