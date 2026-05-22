import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ horseId: string }> },
) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const { horseId } = await params;
  const { json, status } = await safeFetchBackend(
    `${API_URL}/trainers/me/horses/${horseId}`,
    { method: 'DELETE', headers },
  );
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}
