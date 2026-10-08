import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** The gate's class list — ready derived, check-in counts — which the gate
 *  screen polls so changes made elsewhere reach the steward on their own. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ showId: string }> },
) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId } = await params;
  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/gate/classes`, {
    headers,
    cache: 'no-store',
  });
  return NextResponse.json(json, { status });
}
