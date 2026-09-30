import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

type Params = { params: Promise<{ showId: string; userId: string }> };

async function forward(method: 'POST' | 'DELETE', { params }: Params) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId, userId } = await params;
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/company-staff/requests/${userId}`,
    { method, headers },
  );
  return NextResponse.json(json, { status });
}

/** Approve somebody who asked to join: a request to GaitDesk from a member
 *  (202), an addition from an admin. */
export async function POST(_req: NextRequest, ctx: Params) {
  return forward('POST', ctx);
}

/** Turn a request down, or withdraw one the company made. */
export async function DELETE(_req: NextRequest, ctx: Params) {
  return forward('DELETE', ctx);
}
