import { NextRequest, NextResponse } from 'next/server';
import { API_URL } from '@/lib/backend-fetch';

/**
 * The uploaded show bill, streamed through for the browser to render.
 *
 * **Deliberately unauthenticated**, like the backend endpoint behind it. The
 * show bill is the prize list a stranger reads to decide whether to enter — the
 * generated one is already public at `/shows/[id]/showbill`, and a show that
 * chose to upload its own has not made it a secret. This handler exists only
 * because `API_URL` names a container the browser cannot reach; it adds no rule
 * of its own.
 *
 * `?download=1` asks for it as a file rather than in the page.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const download = req.nextUrl.searchParams.get('download') === '1';

  const res = await fetch(
    `${API_URL}/shows/${showId}/showbill-document/file${download ? '?download=true' : ''}`,
    { cache: 'no-store' },
  );
  if (!res.ok) {
    return NextResponse.json({ error: 'No uploaded show bill for this show' }, { status: res.status });
  }

  const data = await res.arrayBuffer();
  return new NextResponse(data, {
    headers: {
      'Content-Type': res.headers.get('content-type') || 'application/octet-stream',
      'Content-Disposition': res.headers.get('content-disposition') || 'inline',
      // Public, and short: a show that replaces its bill needs the new one to
      // reach the people still deciding whether to enter.
      'Cache-Control': 'public, max-age=300',
    },
  });
}
