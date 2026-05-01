import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

export async function POST(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { showId, classId, skipCoggins, ...data } = body;
  const qs = skipCoggins ? '?skip_coggins_check=true' : '';
  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/classes/${classId}/entries/${qs}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  return NextResponse.json(json, { status });
}
