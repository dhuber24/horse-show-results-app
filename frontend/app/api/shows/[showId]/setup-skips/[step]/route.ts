import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** Record that a setup step does not apply to this show (migration 154). */
export async function PUT(_req: NextRequest, { params }: { params: Promise<{ showId: string; step: string }> }) {
  return forward('PUT', await params);
}

/** Bring a skipped setup step back. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ showId: string; step: string }> }) {
  return forward('DELETE', await params);
}

async function forward(method: 'PUT' | 'DELETE', { showId, step }: { showId: string; step: string }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/setup-skips/${encodeURIComponent(step)}`,
    { method, headers },
  );
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}
