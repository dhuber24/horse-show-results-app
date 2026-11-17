import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Change what an exhibitor owes, with the reason the bill prints (migration
 * 197). Positive is a charge, negative a credit — not a payment.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/adjustments`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return NextResponse.json(json, { status });
}
