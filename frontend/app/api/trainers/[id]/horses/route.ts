import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const res = await fetch(`${API_URL}/trainers/${id}/horses`, { headers, cache: 'no-store' });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
