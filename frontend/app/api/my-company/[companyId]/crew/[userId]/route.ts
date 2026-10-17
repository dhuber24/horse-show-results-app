import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** Take somebody off the company's crew, and off its shows that have not finished. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ companyId: string; userId: string }> }) {
  const { companyId, userId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(`${API_URL}/my-company/${companyId}/crew/${userId}`, {
    method: 'DELETE',
    headers,
  });
  return NextResponse.json(json, { status });
}
