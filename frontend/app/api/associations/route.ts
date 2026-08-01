import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

/**
 * The registry of bodies a horse or person can be affiliated with.
 * Not the same list as /api/show-types, which is show configuration.
 * Optional `type` filter: "breed" | "club".
 */
export async function GET(req: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const qs = new URLSearchParams();
  const type = req.nextUrl.searchParams.get('type');
  if (type) qs.set('type', type);
  if (req.nextUrl.searchParams.get('include_inactive') === 'true') {
    qs.set('include_inactive', 'true');
  }

  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await fetch(`${API_URL}/associations/${suffix}`, { headers, cache: 'no-store' });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
