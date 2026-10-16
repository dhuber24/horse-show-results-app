import { NextRequest, NextResponse } from 'next/server';
import { API_URL, getAuthHeaders, safeFetchBackend } from '@/lib/backend-fetch';
import { errorMessage } from '@/lib/api-error';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function myTrainerId(headers: Record<string, string>): Promise<string | null> {
  const { json, status } = await safeFetchBackend(`${API_URL}/trainers/me`, { headers, cache: 'no-store' });
  return status === 200 && typeof json?.id === 'string' ? json.id : null;
}

/**
 * The signed-in trainer's own picture — previewed whatever their plan, so a
 * Basic trainer can see the Pro profile they are putting together. Streams
 * image bytes, so it is on CI's allow-list for raw fetch(); its error path
 * never parses the body.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { docId } = await params;
  if (!UUID_RE.test(docId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const trainerId = await myTrainerId(headers);
  if (!trainerId) return NextResponse.json({ error: 'Trainer profile not found' }, { status: 404 });

  const res = await fetch(`${API_URL}/trainers/${trainerId}/documents/${docId}/download`, { headers, cache: 'no-store' }).catch(() => null);
  if (!res || !res.ok) return NextResponse.json({ error: 'Picture not found' }, { status: res?.status ?? 502 });
  return new NextResponse(await res.arrayBuffer(), {
    status: 200,
    headers: {
      'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream',
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { docId } = await params;
  if (!UUID_RE.test(docId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const trainerId = await myTrainerId(headers);
  if (!trainerId) return NextResponse.json({ error: 'Trainer profile not found' }, { status: 404 });

  const { json, status } = await safeFetchBackend(`${API_URL}/trainers/${trainerId}/documents/${docId}`, {
    method: 'DELETE',
    headers,
  });
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json({ error: errorMessage(json, 'Could not remove the picture.') }, { status });
}
