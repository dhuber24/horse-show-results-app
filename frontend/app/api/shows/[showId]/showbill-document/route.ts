import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * The show's own uploaded show bill — putting one on file, and taking it off.
 *
 * Reading which bill a show uses is public and goes straight to the backend
 * from the page (see `fetchShowbill` in `lib/api.ts`); only the two writes need
 * a session, so only they are here.
 */

export async function POST(req: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await req.formData();
  // Drop Content-Type so fetch sets it with the multipart boundary.
  const { 'Content-Type': _ct, ...forwardHeaders } = headers as Record<string, string>;

  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/showbill-document`,
    { method: 'POST', headers: forwardHeaders, body: formData },
  );
  return NextResponse.json(json, { status });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ showId: string }> },
) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Returns the resolved show bill rather than 204: deleting the file also puts
  // the show back on the generated bill, and the caller has to be able to render
  // that without a second round trip.
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/showbill-document`,
    { method: 'DELETE', headers },
  );
  return NextResponse.json(json, { status });
}
