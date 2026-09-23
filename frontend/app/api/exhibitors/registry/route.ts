import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Every exhibitor record, which is not the same list as every user.
 *
 * `/admin/users` is logins. A person the show office typed in at a desk has
 * none, deliberately — so this is the only list they appear in.
 */
export async function GET(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const params = new URLSearchParams();
  const q = request.nextUrl.searchParams.get('q');
  const scope = request.nextUrl.searchParams.get('scope');
  if (q) params.set('q', q);
  if (scope) params.set('scope', scope);
  const query = params.size ? `?${params}` : '';

  const { json, status } = await safeFetchBackend(`${API_URL}/exhibitors/registry${query}`, {
    headers,
    cache: 'no-store',
  });
  return NextResponse.json(json, { status });
}
