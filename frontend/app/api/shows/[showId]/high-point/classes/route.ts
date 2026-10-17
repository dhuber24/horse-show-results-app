import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** Count classes toward the show's high point, or leave them out (migration
 *  167). Answers with every class, as `GET` on the backend does. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/high-point/classes`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(await req.json()),
  });
  return NextResponse.json(json, { status });
}
