import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** The show inbox's unread count, for the envelope in the top bar. The backend
 *  answers only somebody who works this show (`works_show`), and the button
 *  reads anything else as "not yours to show". */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ showId: string }> },
) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/contact/messages/unread-count`,
    { headers, cache: 'no-store' },
  );
  return NextResponse.json(json, { status });
}
