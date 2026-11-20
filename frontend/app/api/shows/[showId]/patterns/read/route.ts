import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Reading an uploaded pattern file into the show's patterns, each attached to
 * the classes that run it (GaitDesk Pro, `pattern_reading`). The backend
 * refuses a show whose company is not on Pro; this only carries the file.
 * Answers with every pattern on the show, like the class list's saves.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await req.formData();
  // Drop Content-Type so fetch sets it with the multipart boundary.
  const { 'Content-Type': _ct, ...forwardHeaders } = headers as Record<string, string>;

  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/patterns/read`, {
    method: 'POST',
    headers: forwardHeaders,
    body: formData,
  });
  return NextResponse.json(json, { status });
}
