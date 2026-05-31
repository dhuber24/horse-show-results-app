import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

export async function GET(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = request.nextUrl.searchParams.get('role');
  if (!role) {
    return NextResponse.json({ error: 'role query param required' }, { status: 400 });
  }
  const res = await fetch(
    `${API_URL}/users/by-role?role=${encodeURIComponent(role)}`,
    { headers, cache: 'no-store' },
  );
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
