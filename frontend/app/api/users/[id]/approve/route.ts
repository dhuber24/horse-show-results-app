import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const { json, status } = await safeFetchBackend(`${API_URL}/users/${id}/approve`, {
    method: 'PATCH',
    headers,
  });
  return NextResponse.json(json, { status });
}
