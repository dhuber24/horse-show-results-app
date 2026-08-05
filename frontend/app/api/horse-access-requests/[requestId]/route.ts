import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(
    `${API_URL}/horse-access-requests/${requestId}`,
    { method: 'DELETE', headers },
  );
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}
