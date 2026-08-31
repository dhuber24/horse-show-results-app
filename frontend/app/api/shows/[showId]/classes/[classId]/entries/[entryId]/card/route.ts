import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** Save one judge's worksheet for one entry, and get back what it adds up to.
 *
 *  The card does not write `results`: the scored scribe form carries
 *  `effective_score` into its ordinary autosave, so `results.raw_score` keeps
 *  exactly one writer. Two writers over the same number, with a delete-all
 *  bulk save on a 1.5s settle, is how placings go missing. */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ showId: string; classId: string; entryId: string }> },
) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId, classId, entryId } = await params;
  const body = await req.json();
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/classes/${classId}/entries/${entryId}/card`,
    {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  return NextResponse.json(json, { status });
}
