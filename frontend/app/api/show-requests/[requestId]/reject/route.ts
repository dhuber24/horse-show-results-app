import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { requestId } = await params;
  const body = await request.json();
  const { json, status } = await safeFetchBackend(
    `${API_URL}/show-requests/${requestId}/reject`,
    { method: 'PATCH', headers, body: JSON.stringify(body) },
  );
  return NextResponse.json(json, { status });
}
