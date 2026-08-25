import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ classId: string; assocId: string }> },
) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { classId, assocId } = await params;
  const { searchParams } = new URL(request.url);
  const showId = searchParams.get('showId');
  if (!showId) return NextResponse.json({ error: 'showId is required' }, { status: 400 });

  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/classes/${classId}/associations/${assocId}`,
    { method: 'DELETE', headers },
  );
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}
