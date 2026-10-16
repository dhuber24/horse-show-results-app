import { NextRequest, NextResponse } from 'next/server';
import { API_URL, getAuthHeaders, safeFetchBackend } from '@/lib/backend-fetch';
import { errorMessage } from '@/lib/api-error';

/** An admin recording a trainer's Pro: paid through a date, or none. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const { json, status } = await safeFetchBackend(`${API_URL}/trainers/${id}/pro`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  if (status >= 400) return NextResponse.json({ error: errorMessage(json, 'Could not save Pro.') }, { status });
  return NextResponse.json(json, { status });
}
