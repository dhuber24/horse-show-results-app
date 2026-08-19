import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** The exhibitor signing for themselves. Staff recording a paper blank go
 *  through the exhibitor-scoped route instead — different actor, different row. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ showId: string; waiverId: string }> },
) {
  const { showId, waiverId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/waivers/${waiverId}/signature`,
    { method: 'POST', headers, body: JSON.stringify(body) },
  );
  return NextResponse.json(json, { status });
}
