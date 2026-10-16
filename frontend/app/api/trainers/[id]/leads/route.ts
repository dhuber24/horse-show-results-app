import { NextRequest, NextResponse } from 'next/server';
import { API_URL, safeFetchBackend } from '@/lib/backend-fetch';
import { errorMessage } from '@/lib/api-error';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Contact Trainer form on a Pro listing. No session needed. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Trainer not found' }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const { json, status } = await safeFetchBackend(`${API_URL}/trainers/${id}/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (status >= 400) {
    return NextResponse.json({ error: errorMessage(json, 'Your message could not be sent.') }, { status });
  }
  return NextResponse.json(json, { status });
}
