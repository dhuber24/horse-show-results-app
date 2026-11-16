import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** The confirm page's two notes drafted again for its dates, the judges left
 *  off and whether a venue is settled. Writes nothing. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ importId: string }> }) {
  const { importId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  const { json, status } = await safeFetchBackend(
    `${API_URL}/show-bill-imports/${importId}/draft-notes`,
    { method: 'POST', headers, body: JSON.stringify(body) },
  );
  return NextResponse.json(json, { status });
}
