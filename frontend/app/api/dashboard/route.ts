import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  const { json, status } = await safeFetchBackend(`${API_URL}/dashboard/exhibitor/${userId}`, { headers });
  return NextResponse.json(json);
}
