import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Putting a pattern on file (migration 146).
 *
 * Reading the list is public and goes straight to the backend from the page
 * (`fetchShowPatterns` in `lib/api.ts`); only the writes need a session.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await req.formData();
  // Drop Content-Type so fetch sets it with the multipart boundary.
  const { 'Content-Type': _ct, ...forwardHeaders } = headers as Record<string, string>;

  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/patterns`, {
    method: 'POST',
    headers: forwardHeaders,
    body: formData,
  });
  return NextResponse.json(json, { status });
}
