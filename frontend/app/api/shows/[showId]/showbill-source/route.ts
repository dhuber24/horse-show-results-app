import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Which show bill the Show Bill button opens.
 *
 * A separate endpoint from the show PATCH on purpose — see the note on
 * `set_showbill_source` in `backend/routers/show_documents.py`. The backend 422s
 * an attempt to select the uploaded bill with no file on record, and that status
 * is passed straight through so the screen can print the reason.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/showbill-source`,
    { method: 'PUT', headers, body: JSON.stringify(body) },
  );
  return NextResponse.json(json, { status });
}
