import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Before merging `?other=` into this record: every question the two records
 * answer differently, for the office to pick the right answer to. Refuses what
 * the merge itself would refuse (two logins, neither record on this show).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ showId: string; exhibitorId: string }> },
) {
  const { showId, exhibitorId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const other = request.nextUrl.searchParams.get('other') ?? '';
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/desk/exhibitors/${exhibitorId}/merge-conflicts?other=${encodeURIComponent(other)}`,
    { headers, cache: 'no-store' },
  );
  return NextResponse.json(json, { status });
}
