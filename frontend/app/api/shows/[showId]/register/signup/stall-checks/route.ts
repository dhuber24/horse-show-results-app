import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * The stall checks for a booking the sign-up form has not saved yet
 * (migration 194). Asked as the quantities change; writes nothing.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/register/signup/stall-checks`,
    { method: 'POST', headers, body: JSON.stringify(body) },
  );
  return NextResponse.json(json, { status });
}
