import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

type Params = { params: Promise<{ showId: string; classId: string; photoId: string }> };

/** Taking a photo off the class — a blurry one, or the wrong card. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { showId, classId, photoId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/classes/${classId}/card-photos/${photoId}`,
    { method: 'DELETE', headers },
  );
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}
