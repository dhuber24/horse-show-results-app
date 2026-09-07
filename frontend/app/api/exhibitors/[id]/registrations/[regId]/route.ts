import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Correct a membership already on file — in practice, supply the expiry date a
 * breed membership now requires on rows that predate the rule. Without this the
 * only way to add one would be to delete the membership and retype the number.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; regId: string }> },
) {
  const { id, regId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { json, status } = await safeFetchBackend(`${API_URL}/exhibitors/${id}/registrations/${regId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  return NextResponse.json(json, { status });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; regId: string }> },
) {
  const { id, regId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(`${API_URL}/exhibitors/${id}/registrations/${regId}`, {
    method: 'DELETE',
    headers,
  });
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}
