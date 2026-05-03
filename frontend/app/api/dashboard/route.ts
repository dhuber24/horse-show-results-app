import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  const res = await fetch(`${API_URL}/dashboard/exhibitor/${userId}`, { headers });
  const json = await res.json();
  return NextResponse.json(json);
}
