import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

export async function POST(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { showId, classId, skipCoggins, ...data } = body;
  const qs = skipCoggins ? '?skip_coggins_check=true' : '';
  const res = await fetch(`${API_URL}/shows/${showId}/classes/${classId}/entries/${qs}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
