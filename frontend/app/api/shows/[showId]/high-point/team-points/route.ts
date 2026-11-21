import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** Count the show's team classes toward individual (division) high point as
 *  well as Team High Point, or not (migration 208). Answers with every class,
 *  as `GET .../high-point/classes` does. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/high-point/team-points`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(await req.json()),
  });
  return NextResponse.json(json, { status });
}
