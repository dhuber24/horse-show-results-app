import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** Approve somebody who typed the company's name at sign-up. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ companyId: string; userId: string }> }) {
  const { companyId, userId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(`${API_URL}/my-company/${companyId}/join-requests/${userId}`, {
    method: 'POST',
    headers,
  });
  return NextResponse.json(json, { status });
}

/** Decline them. They keep the company of their own sign-up gave them. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ companyId: string; userId: string }> }) {
  const { companyId, userId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(`${API_URL}/my-company/${companyId}/join-requests/${userId}`, {
    method: 'DELETE',
    headers,
  });
  return NextResponse.json(json, { status });
}
