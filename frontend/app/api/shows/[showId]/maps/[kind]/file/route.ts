import { NextRequest, NextResponse } from 'next/server';
import { API_URL } from '@/lib/backend-fetch';

/**
 * A show's stall map or RV map, streamed through for the browser to open.
 *
 * **Deliberately unauthenticated**, like the backend endpoint behind it and the
 * show bill's file route beside it: a barn layout is posted on the gate. This
 * handler exists only because `API_URL` names a container the browser cannot
 * reach; it adds no rule of its own. `?download=1` asks for it as a file.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ showId: string; kind: string }> },
) {
  const { showId, kind } = await params;
  const download = req.nextUrl.searchParams.get('download') === '1';

  const res = await fetch(
    `${API_URL}/shows/${showId}/maps/${encodeURIComponent(kind)}/file${download ? '?download=true' : ''}`,
    { cache: 'no-store' },
  );
  if (!res.ok) {
    return NextResponse.json({ error: 'No map of that kind for this show' }, { status: res.status });
  }

  const data = await res.arrayBuffer();
  return new NextResponse(data, {
    headers: {
      'Content-Type': res.headers.get('content-type') || 'application/octet-stream',
      'Content-Disposition': res.headers.get('content-disposition') || 'inline',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
