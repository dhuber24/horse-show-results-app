import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Name + id for the owner pickers, and for the desk's add-somebody search.
 *
 * `?dedupe=false` is the desk's: an owner picker wants one row per person, but
 * a desk looking at somebody who is on the app twice has to see both records
 * to merge them.
 *
 * `?accounts_only=true` is for a picker whose action needs the person to press
 * something — a horse transfer has to be accepted, and an approver with no
 * account can never accept it. Owning a horse needs no account, so the owner
 * pickers leave it off.
 */
export async function GET(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const params = new URLSearchParams();
  if (request.nextUrl.searchParams.get('dedupe') === 'false') params.set('dedupe', 'false');
  if (request.nextUrl.searchParams.get('accounts_only') === 'true') {
    params.set('accounts_only', 'true');
  }
  const query = params.size ? `?${params}` : '';
  const { json, status } = await safeFetchBackend(`${API_URL}/exhibitors/names${query}`, {
    headers,
    cache: 'no-store',
  });
  return NextResponse.json(json, { status });
}
