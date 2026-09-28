import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** Add a colleague to the caller's company by the email their account uses. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(`${API_URL}/my-company/${companyId}/members`, {
    method: 'POST',
    headers,
    body: JSON.stringify(await req.json()),
  });
  return NextResponse.json(json, { status });
}
