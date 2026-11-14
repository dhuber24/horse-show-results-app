import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** Create the show as a DRAFT from its read (migration 187). The body is the
 *  four values a person confirmed — name, show type, dates — and whether to keep
 *  the bill on file; everything else comes from the read, with every doubt a
 *  check on its setup step. */
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
