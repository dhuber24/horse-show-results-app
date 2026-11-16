import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** The desk names the rest of a team entry (migration 192). The whole team but
 *  the rider who entered it, in order — see `backend/teams.py`. */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ showId: string; classId: string; entryId: string }> },
) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { showId, classId, entryId } = await params;
  const body = await request.text();
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/classes/${classId}/entries/${entryId}/team`,
    { method: 'PUT', headers, body },
  );
  return NextResponse.json(json, { status });
}
