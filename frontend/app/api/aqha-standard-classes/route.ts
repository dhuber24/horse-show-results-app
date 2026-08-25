import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

export async function GET(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const params = new URLSearchParams();
  if (searchParams.get('q')) params.set('q', searchParams.get('q')!);
  if (searchParams.get('division')) params.set('division', searchParams.get('division')!);

  const qs = params.toString();
  const { json, status } = await safeFetchBackend(`${API_URL}/aqha-standard-classes/${qs ? `?${qs}` : ''}`, { headers });
  return NextResponse.json(json, { status });
}
