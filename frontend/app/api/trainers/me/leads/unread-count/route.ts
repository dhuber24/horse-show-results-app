import { NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** A trainer's unread Contact Trainer messages — the number on their envelope. */
export async function GET() {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(`${API_URL}/trainers/me/leads/unread-count`, {
    headers,
    cache: 'no-store',
  });
  return NextResponse.json(json, { status });
}
