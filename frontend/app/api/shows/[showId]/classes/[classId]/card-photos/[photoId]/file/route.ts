import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

type Params = { params: Promise<{ showId: string; classId: string; photoId: string }> };

/**
 * A photo of a judge's card, streamed through for the browser to show.
 *
 * Read by anybody once the class is posted, like the results beside it — at
 * the rail, on a phone, usually signed out. Before then only show staff get
 * it, so the session's headers go along when there is one and the backend
 * decides; a signed-out reader of an unposted class gets the 404 a missing
 * photo gets.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { showId, classId, photoId } = await params;
  const session = await getAuthHeaders();
  const headers: Record<string, string> = {};
  if (session) {
    const { 'Content-Type': _ct, ...rest } = session;
    Object.assign(headers, rest);
  }

  const res = await fetch(
    `${API_URL}/shows/${showId}/classes/${classId}/card-photos/${photoId}/file`,
    { headers, cache: 'no-store' },
  );
  if (!res.ok) {
    return NextResponse.json({ error: 'Photo not found' }, { status: res.status });
  }

  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'Content-Type': res.headers.get('content-type') || 'application/octet-stream',
      'Content-Disposition': res.headers.get('content-disposition') || 'inline',
      // A photo is never replaced in place, so it may be kept; private,
      // because before the class is posted it is a staff-only answer.
      'Cache-Control': res.headers.get('cache-control') || 'private, max-age=86400',
    },
  });
}
