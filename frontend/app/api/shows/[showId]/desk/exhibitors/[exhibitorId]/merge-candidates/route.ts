import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Other records that might be this same person.
 *
 * Read when staff open the merge control rather than with the desk payload:
 * it is a query per candidate, and the desk is one read by design.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ showId: string; exhibitorId: string }> },
) {
  const { showId, exhibitorId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/desk/exhibitors/${exhibitorId}/merge-candidates`,
    { headers, cache: 'no-store' },
  );
  return NextResponse.json(json, { status });
}
