import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** Cancel an invite still waiting. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ companyId: string; inviteId: string }> }) {
  const { companyId, inviteId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(`${API_URL}/my-company/${companyId}/invites/${inviteId}`, {
    method: 'DELETE',
    headers,
  });
  return NextResponse.json(json, { status });
}
