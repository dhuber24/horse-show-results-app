import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ showId: string; classId: string }> },
) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId, classId } = await params;
  const body = await request.json();
  const res = await fetch(`${API_URL}/shows/${showId}/gate/classes/${classId}/order`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
