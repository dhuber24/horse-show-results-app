import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** The card shapes available — how a judge's card is marked, and the penalties
 *  each system recognises. `showType` narrows to one association's, plus the
 *  generic ones, the same fallback the standard-class library uses. */
export async function GET(req: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const showType = req.nextUrl.searchParams.get('showType');
  const query = showType ? `?show_type=${encodeURIComponent(showType)}` : '';
  const { json, status } = await safeFetchBackend(
    `${API_URL}/judging-systems/${query}`,
    { headers },
  );
  return NextResponse.json(json, { status });
}
