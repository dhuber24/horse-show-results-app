import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** Every judge's card filed for this class. Staff only — a card is the scribe's
 *  worksheet and never reaches the public screens; what the public sees is the
 *  result it produced, which the publish gate already governs. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ showId: string; classId: string }> },
) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId, classId } = await params;
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/classes/${classId}/cards`,
    { headers },
  );
  return NextResponse.json(json, { status });
}
