import { NextRequest, NextResponse } from 'next/server';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

// Same reasoning as the GET alongside it: the token names one request, the
// session says whether the caller may answer it. Approving a horse you don't
// own is the one outcome this whole table exists to prevent, so the check is
// the backend's and this handler only carries the identity across.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = await request.json();
  const authHeaders = await getAuthHeaders();
  const res = await fetch(
    `${API_URL}/horse-access-requests/by-token/${encodeURIComponent(token)}/respond`,
    {
      method: 'POST',
      headers: authHeaders ?? { 'Content-Type': 'application/json', 'X-API-Key': INTERNAL_API_KEY },
      body: JSON.stringify(body),
    },
  );
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
