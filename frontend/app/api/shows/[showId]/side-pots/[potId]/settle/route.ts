import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

type Ctx = { params: Promise<{ showId: string; potId: string }> };

export async function POST(_request: NextRequest, { params }: Ctx) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId, potId } = await params;
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/side-pots/${potId}/settle`,
    { method: 'POST', headers },
  );
  return NextResponse.json(json, { status });
}
