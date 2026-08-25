import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ showId: string }> },
) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const statusFilter = request.nextUrl.searchParams.get('status');
  const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
  const { json, status } = await safeFetchBackend(`${API_URL}/shows/${showId}/contact/messages${qs}`, {
    headers,
    cache: 'no-store',
  });
  return NextResponse.json(json, { status });
}
