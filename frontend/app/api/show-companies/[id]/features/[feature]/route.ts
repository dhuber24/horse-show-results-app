import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Turn a paid feature on (PUT) or off (DELETE) for a show company. Both are
 * idempotent and answer with the whole company, so the screen redraws from
 * what the backend now holds.
 */
type Params = { params: Promise<{ id: string; feature: string }> };

async function forward(method: 'PUT' | 'DELETE', { params }: Params) {
  const { id, feature } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { json, status } = await safeFetchBackend(
    `${API_URL}/show-companies/${id}/features/${encodeURIComponent(feature)}`,
    { method, headers },
  );
  return NextResponse.json(json, { status });
}

export async function PUT(_req: NextRequest, ctx: Params) {
  return forward('PUT', ctx);
}

export async function DELETE(_req: NextRequest, ctx: Params) {
  return forward('DELETE', ctx);
}
