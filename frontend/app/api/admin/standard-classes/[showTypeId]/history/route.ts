import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** Past imports for one association, newest first. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ showTypeId: string }> },
) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { showTypeId } = await params;
  const { json, status } = await safeFetchBackend(
    `${API_URL}/standard-class-imports/${showTypeId}/history`,
    { headers, cache: 'no-store' },
  );
  return NextResponse.json(json, { status });
}
