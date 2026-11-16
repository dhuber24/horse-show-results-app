import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** A teammate's horses at this show, for the horse they ride on the team. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ showId: string; exhibitorId: string }> },
) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { showId, exhibitorId } = await params;
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/register/teammates/${exhibitorId}/horses`,
    { headers },
  );
  return NextResponse.json(json, { status });
}
