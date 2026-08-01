import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

export async function GET(req: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) {
    return NextResponse.json({ error: 'Enter at least 2 characters to search' }, { status: 400 });
  }

  const qs = new URLSearchParams({ q });
  const limit = req.nextUrl.searchParams.get('limit');
  if (limit) qs.set('limit', limit);

  const res = await fetch(`${API_URL}/horses/search?${qs.toString()}`, { headers });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
