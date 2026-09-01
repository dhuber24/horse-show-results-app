import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Cancel a registration from the desk.
 *
 * The office's half of the two-week rule: an exhibitor may cancel their own up
 * to a fortnight out, and inside that window this is the only door. Not the
 * same call as `DELETE /desk/exhibitors/{id}`, which is the undo for adding
 * the wrong person to the roster.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ showId: string; exhibitorId: string }> },
) {
  const { showId, exhibitorId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/desk/exhibitors/${exhibitorId}/cancel`,
    { method: 'POST', headers, body: JSON.stringify(body ?? {}) },
  );
  return NextResponse.json(json, { status });
}
