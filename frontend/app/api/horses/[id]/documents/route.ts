import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const res = await fetch(`${API_URL}/horses/${id}/documents`, { headers });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await req.formData();
  // Remove Content-Type so fetch sets it automatically with the multipart boundary
  const { 'Content-Type': _ct, ...forwardHeaders } = headers as Record<string, string>;

  const res = await fetch(`${API_URL}/horses/${id}/documents`, {
    method: 'POST',
    headers: forwardHeaders,
    body: formData,
  });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
