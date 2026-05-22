import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { API_URL, getAuthHeaders, safeFetchBackend } from '@/lib/backend-fetch';

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

export async function GET() {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const res = await fetch(`${API_URL}/trainers/me/headshot`, { headers, cache: 'no-store' });
  if (!res.ok) {
    return NextResponse.json({ detail: 'No headshot' }, { status: res.status });
  }
  const buf = await res.arrayBuffer();
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    },
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  // Look up the trainer id for the current user so we can hit the existing
  // /trainers/{id}/documents endpoint.
  const authHeaders = await getAuthHeaders();
  if (!authHeaders) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const meRes = await fetch(`${API_URL}/trainers/me`, { headers: authHeaders, cache: 'no-store' });
  if (!meRes.ok) {
    const err = await meRes.json().catch(() => ({}));
    return NextResponse.json(err, { status: meRes.status });
  }
  const me = await meRes.json();

  const incoming = await request.formData();
  const forwardForm = new FormData();
  const file = incoming.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ detail: 'Missing file' }, { status: 400 });
  }
  forwardForm.append('file', file);
  forwardForm.append('document_type', 'HEADSHOT');

  const res = await fetch(`${API_URL}/trainers/${me.id}/documents`, {
    method: 'POST',
    // Don't set Content-Type — the FormData boundary is auto-applied.
    headers: {
      'X-API-Key': INTERNAL_API_KEY,
      'X-User-Id': session.user.id,
      'X-User-Role': session.user.role,
    },
    body: forwardForm,
  });
  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}

export async function DELETE() {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const meRes = await fetch(`${API_URL}/trainers/me`, { headers, cache: 'no-store' });
  if (!meRes.ok) {
    const err = await meRes.json().catch(() => ({}));
    return NextResponse.json(err, { status: meRes.status });
  }
  const me = await meRes.json();

  const listRes = await fetch(`${API_URL}/trainers/${me.id}/documents`, { headers, cache: 'no-store' });
  if (!listRes.ok) {
    const err = await listRes.json().catch(() => ({}));
    return NextResponse.json(err, { status: listRes.status });
  }
  const docs: Array<{ id: string; document_type: string }> = await listRes.json();
  const headshot = docs.find((d) => d.document_type === 'HEADSHOT');
  if (!headshot) return new NextResponse(null, { status: 204 });

  const { json, status } = await safeFetchBackend(
    `${API_URL}/trainers/${me.id}/documents/${headshot.id}`,
    { method: 'DELETE', headers },
  );
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}
