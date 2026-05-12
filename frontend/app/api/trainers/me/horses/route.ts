import { NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

export async function GET() {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const res = await fetch(`${API_URL}/trainers/me/horses`, { headers, cache: 'no-store' });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
