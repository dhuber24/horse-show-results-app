import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

export async function GET(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const showTypeId = searchParams.get('show_type_id');
  const url = showTypeId
    ? `${API_URL}/standard-setup/pairs?show_type_id=${encodeURIComponent(showTypeId)}`
    : `${API_URL}/standard-setup/pairs`;
  const { json, status } = await safeFetchBackend(url, { headers });
  return NextResponse.json(json, { status });
}
