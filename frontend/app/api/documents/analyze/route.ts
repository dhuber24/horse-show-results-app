import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Read a document that has no horse yet — the add-a-horse wizard stages
 * paperwork before the horse is created, so it cannot use the horse-scoped
 * analyze route.
 */
export async function POST(req: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await req.formData();
  // Remove Content-Type so fetch sets it automatically with the multipart boundary
  const { 'Content-Type': _ct, ...forwardHeaders } = headers as Record<string, string>;

  const { json, status } = await safeFetchBackend(`${API_URL}/documents/analyze`, {
    method: 'POST',
    headers: forwardHeaders,
    body: formData,
  });
  return NextResponse.json(json, { status });
}
