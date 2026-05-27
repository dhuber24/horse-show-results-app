import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

export async function GET(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const showTypeId = searchParams.get('show_type_id');
  if (!showTypeId) {
    return NextResponse.json({ error: 'show_type_id required' }, { status: 400 });
  }
  const res = await fetch(
    `${API_URL}/standard-setup/catalog?show_type_id=${encodeURIComponent(showTypeId)}`,
    { headers, cache: 'no-store' },
  );
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
