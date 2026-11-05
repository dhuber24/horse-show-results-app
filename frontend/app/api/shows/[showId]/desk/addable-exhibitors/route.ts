import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Who the desk can offer to add to this show: anybody a picker may offer, or until
 * GaitDesk has verified the show's company, only who it can reach (migration 180).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/desk/addable-exhibitors`, { headers });
  return NextResponse.json(json, { status });
}
