import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** Take an office adjustment off an exhibitor's bill (migration 197). */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ showId: string; adjustmentId: string }> },
) {
  const { showId, adjustmentId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/adjustments/${adjustmentId}`,
    { method: 'DELETE', headers },
  );
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}
