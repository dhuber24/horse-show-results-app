import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** Create the show as a DRAFT from its read. The body is what the confirm page
 *  settled — name, show type, dates, who each judge is, the venue, the two
 *  notes, whether to keep the bill on file; everything else comes from the read. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ importId: string }> }) {
  const { importId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  const { json, status } = await safeFetchBackend(
    `${API_URL}/show-bill-imports/${importId}/create-show`,
    { method: 'POST', headers, body: JSON.stringify(body) },
  );
  return NextResponse.json(json, { status });
}
