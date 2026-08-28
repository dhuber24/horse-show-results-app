import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** What an association's class-code catalog holds now. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ showTypeId: string }> },
) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { showTypeId } = await params;
  const { json, status } = await safeFetchBackend(
    `${API_URL}/standard-class-imports/${showTypeId}`,
    { headers, cache: 'no-store' },
  );
  return NextResponse.json(json, { status });
}
