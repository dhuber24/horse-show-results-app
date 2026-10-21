import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** Choose GaitDesk Basic or Pro for the company (migration 169) -- or, during a
 *  Pro+ year, Pro+ again to renew it (migration 175). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(`${API_URL}/my-company/${companyId}/plan`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(await req.json()),
  });
  return NextResponse.json(json, { status });
}
