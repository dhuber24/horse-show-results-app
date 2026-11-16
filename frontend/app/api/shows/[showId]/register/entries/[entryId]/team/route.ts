import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** The exhibitor names the rest of the team on their own entry (migration 192). */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ showId: string; entryId: string }> },
) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { showId, entryId } = await params;
  const body = await request.text();
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/register/entries/${entryId}/team`,
    { method: 'PUT', headers, body },
  );
  return NextResponse.json(json, { status });
}
