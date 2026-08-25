import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const { json, status } = await safeFetchBackend(`${API_URL}/trainers/${id}/registrations`, { headers, cache: 'no-store' });
  return NextResponse.json(json, { status });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await request.json();
  const { json, status } = await safeFetchBackend(`${API_URL}/trainers/${id}/registrations`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return NextResponse.json(json, { status });
}
