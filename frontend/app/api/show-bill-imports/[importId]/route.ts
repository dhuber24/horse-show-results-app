import { NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** One read of a show bill — polled while it runs, then the draft to review. */
export async function GET(_req: Request, { params }: { params: Promise<{ importId: string }> }) {
  const { importId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { json, status } = await safeFetchBackend(`${API_URL}/show-bill-imports/${importId}`, {
    headers,
    cache: 'no-store',
  });
  return NextResponse.json(json, { status });
}

/** Cancel an upload that has not become a show: the backend deletes it. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ importId: string }> }) {
  const { importId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { json, status } = await safeFetchBackend(`${API_URL}/show-bill-imports/${importId}`, {
    method: 'DELETE',
    headers,
  });
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}
