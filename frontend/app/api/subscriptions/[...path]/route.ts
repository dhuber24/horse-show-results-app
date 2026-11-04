import { NextRequest, NextResponse } from 'next/server';
import { API_URL, getAuthHeaders, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Manage Subscriptions, straight through to `routers/subscriptions.py`. Every
 * endpoint there is one screen's and takes the same treatment, and every one is
 * ADMIN only on the backend, so one handler rather than eight.
 */
async function forward(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { path } = await params;
  const url = `${API_URL}/subscriptions/${path.map(encodeURIComponent).join('/')}`;
  const hasBody = request.method === 'POST' || request.method === 'PUT';
  const { json, status } = await safeFetchBackend(url, {
    method: request.method,
    headers,
    ...(hasBody ? { body: JSON.stringify(await request.json().catch(() => ({}))) } : {}),
  });
  if (status === 204) return new NextResponse(null, { status });
  return NextResponse.json(json, { status });
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const DELETE = forward;
