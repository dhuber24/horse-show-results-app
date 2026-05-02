import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

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

  const res = await fetch(
    `${API_URL}/shows/${showId}/classes/${classId}/associations/${assocId}`,
    { method: 'DELETE', headers },
  );
  if (res.status === 204) return new NextResponse(null, { status: 204 });
  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}
