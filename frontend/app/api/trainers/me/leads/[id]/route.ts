import { NextRequest, NextResponse } from 'next/server';
import { API_URL, getAuthHeaders, safeFetchBackend } from '@/lib/backend-fetch';
import { errorMessage } from '@/lib/api-error';

/** Mark one of the trainer's messages new, read or archived. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const { json, status } = await safeFetchBackend(`${API_URL}/trainers/me/leads/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body ?? {}),
  });
  if (status >= 400) return NextResponse.json({ error: errorMessage(json, 'Could not update that message.') }, { status });
  return NextResponse.json(json, { status });
}
