import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ venueId: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { venueId } = await params;
  const { json, status } = await safeFetchBackend(`${API_URL}/venues/${venueId}/admins`, { headers });
  return NextResponse.json(json, { status });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ venueId: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { venueId } = await params;
  const body = await request.json();
  const { json, status } = await safeFetchBackend(`${API_URL}/venues/${venueId}/admins`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return NextResponse.json(json, { status });
}
