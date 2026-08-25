import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ showId: string; classId: string }> },
) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId, classId } = await params;
  const body = await request.json();
  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/gate/classes/${classId}/order`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  return NextResponse.json(json, { status });
}
