import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

export async function GET(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const showTypeId = searchParams.get('show_type_id');
  const url = showTypeId
    ? `${API_URL}/standard-setup/divisions?show_type_id=${encodeURIComponent(showTypeId)}`
    : `${API_URL}/standard-setup/divisions`;
  const res = await fetch(url, { headers, cache: 'no-store' });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
