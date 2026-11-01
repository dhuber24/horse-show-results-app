import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

type Params = { params: Promise<{ showId: string; classId: string }> };

/**
 * Attaching a photo of a judge's card to the class (migration 177), from the
 * scribe screen. The list is read from the page server-side
 * (`fetchCardPhotos` in `lib/api.ts`); only the writes need this handler.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { showId, classId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await req.formData();
  // Drop Content-Type so fetch sets it with the multipart boundary.
  const { 'Content-Type': _ct, ...forwardHeaders } = headers;

  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/classes/${classId}/card-photos`,
    { method: 'POST', headers: forwardHeaders, body: formData },
  );
  return NextResponse.json(json, { status });
}
