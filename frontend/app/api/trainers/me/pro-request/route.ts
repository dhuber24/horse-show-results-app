import { NextRequest, NextResponse } from 'next/server';
import { API_URL, getAuthHeaders, safeFetchBackend } from '@/lib/backend-fetch';
import { errorMessage } from '@/lib/api-error';

/** Ask GaitDesk for Trainer Registry Pro (`POST`), or withdraw the ask (`DELETE`). */
export async function POST(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const { json, status } = await safeFetchBackend(`${API_URL}/trainers/me/pro-request`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });
  if (status >= 400) return NextResponse.json({ error: errorMessage(json, 'Could not send your request.') }, { status });
  return NextResponse.json(json, { status });
}

export async function DELETE() {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { json, status } = await safeFetchBackend(`${API_URL}/trainers/me/pro-request`, { method: 'DELETE', headers });
  if (status >= 400) return NextResponse.json({ error: errorMessage(json, 'Could not withdraw your request.') }, { status });
  return NextResponse.json(json, { status });
}
