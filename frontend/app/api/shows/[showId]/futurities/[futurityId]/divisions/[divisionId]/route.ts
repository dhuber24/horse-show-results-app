import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

type Ctx = {
  params: Promise<{ showId: string; futurityId: string; divisionId: string }>;
};

export async function PUT(request: NextRequest, { params }: Ctx) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId, futurityId, divisionId } = await params;
  const body = await request.json();
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/futurities/${futurityId}/divisions/${divisionId}`,
    { method: 'PUT', headers, body: JSON.stringify(body) },
  );
  return NextResponse.json(json, { status });
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { showId, futurityId, divisionId } = await params;
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/futurities/${futurityId}/divisions/${divisionId}`,
    { method: 'DELETE', headers },
  );
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}
