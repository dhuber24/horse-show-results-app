import { NextRequest, NextResponse } from 'next/server';
import { API_URL, getAuthHeaders, safeFetchBackend } from '@/lib/backend-fetch';
import { errorMessage } from '@/lib/api-error';

/** An admin dismissing a trainer's request for Pro without granting it. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const { json, status } = await safeFetchBackend(`${API_URL}/trainers/${id}/pro-request`, { method: 'DELETE', headers });
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json({ error: errorMessage(json, 'Could not dismiss the request.') }, { status });
}
