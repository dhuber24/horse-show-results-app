import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

type Params = { params: Promise<{ showId: string; patternId: string }> };

/**
 * A pattern's file, streamed through for the browser to open.
 *
 * **Deliberately unauthenticated**, like the backend endpoint behind it: a
 * pattern is read at the rail on a phone, usually by somebody who never signed
 * in. This handler exists only because `API_URL` names a container the browser
 * cannot reach. `?download=1` asks for it as a file rather than in the page;
 * `?v=` is a cache-buster the backend ignores.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { showId, patternId } = await params;
  const download = req.nextUrl.searchParams.get('download') === '1';

  const res = await fetch(
    `${API_URL}/shows/${showId}/patterns/${patternId}/file${download ? '?download=true' : ''}`,
    { cache: 'no-store' },
  );
  if (!res.ok) {
    return NextResponse.json({ error: 'Pattern not found' }, { status: res.status });
  }

  const data = await res.arrayBuffer();
  return new NextResponse(data, {
    headers: {
      'Content-Type': res.headers.get('content-type') || 'application/octet-stream',
      'Content-Disposition': res.headers.get('content-disposition') || 'inline',
      // Revalidate every time: a judge can change a pattern an hour before the
      // class, and a phone holding the old copy is the hazard itself.
      'Cache-Control': 'no-cache',
    },
  });
}

/** Replacing the file — the judge changed the pattern. Classes stay assigned. */
export async function PUT(req: NextRequest, { params }: Params) {
  const { showId, patternId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await req.formData();
  const { 'Content-Type': _ct, ...forwardHeaders } = headers as Record<string, string>;

  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/patterns/${patternId}/file`,
    { method: 'PUT', headers: forwardHeaders, body: formData },
  );
  return NextResponse.json(json, { status });
}
