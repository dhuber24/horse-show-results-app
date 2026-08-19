import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Show staff writing an emergency contact onto an exhibitor's profile.
 *
 * Separate from `PATCH /exhibitors/{id}`, which is ADMIN-or-self: this one is
 * scoped to the show's roster, so a secretary can take the number over the
 * counter instead of asking someone to go and edit their own account with a
 * queue behind them.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ showId: string; exhibitorId: string }> },
) {
  const { showId, exhibitorId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/exhibitors/${exhibitorId}/emergency-contact`,
    { method: 'PATCH', headers, body: JSON.stringify(body) },
  );
  return NextResponse.json(json, { status });
}
