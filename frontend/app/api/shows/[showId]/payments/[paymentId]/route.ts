import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Remove a payment recorded in error.
 *
 * This is for a mistyped row, not for giving money back — a genuine refund is
 * recorded as a negative payment so the fact that money moved twice survives.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ showId: string; paymentId: string }> },
) {
  const { showId, paymentId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/payments/${paymentId}`,
    { method: 'DELETE', headers },
  );
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}
