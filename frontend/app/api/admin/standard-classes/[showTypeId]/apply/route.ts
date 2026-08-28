import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** Apply an uploaded class list. The file is re-sent with the retirements ticked. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ showTypeId: string }> },
) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { showTypeId } = await params;
  const formData = await req.formData();
  // Drop Content-Type so fetch sets the multipart boundary itself.
  const { 'Content-Type': _ct, ...forwardHeaders } = headers as Record<string, string>;

  const { json, status } = await safeFetchBackend(
    `${API_URL}/standard-class-imports/${showTypeId}/apply`,
    { method: 'POST', headers: forwardHeaders, body: formData },
  );
  return NextResponse.json(json, { status });
}
