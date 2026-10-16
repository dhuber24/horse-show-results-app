import { NextRequest, NextResponse } from 'next/server';
import { API_URL } from '@/lib/backend-fetch';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One of a Pro trainer's pictures — headshot, logo or a gallery photo — for
 * the public Trainer Registry. No session: the backend serves it only while the
 * trainer is listed and on Pro.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(docId)) return NextResponse.json({ detail: 'Not found' }, { status: 404 });

  let res: Response;
  try {
    res = await fetch(`${API_URL}/trainers/${id}/media/${docId}`, { cache: 'no-store' });
  } catch {
    return NextResponse.json({ detail: 'Backend unavailable' }, { status: 502 });
  }
  if (!res.ok) return NextResponse.json({ detail: 'Picture not available' }, { status: res.status });

  const buf = await res.arrayBuffer();
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
