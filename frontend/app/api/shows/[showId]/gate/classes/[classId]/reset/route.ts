import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ showId: string; classId: string }> },
) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId, classId } = await params;
  const res = await fetch(`${API_URL}/shows/${showId}/gate/classes/${classId}/reset`, {
    method: 'POST',
    headers,
  });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
