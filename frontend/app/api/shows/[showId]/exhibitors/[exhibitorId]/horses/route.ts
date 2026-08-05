import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

/** Show staff creating a horse for an exhibitor standing at the desk. The
 *  backend limits this to exhibitors on that show's roster. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ showId: string; exhibitorId: string }> },
) {
  const { showId, exhibitorId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const res = await fetch(`${API_URL}/shows/${showId}/exhibitors/${exhibitorId}/horses`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
