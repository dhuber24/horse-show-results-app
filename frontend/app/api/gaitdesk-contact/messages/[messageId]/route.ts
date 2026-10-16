import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

// Mark a message to GaitDesk read, unread or archived. ADMIN only — the
// backend refuses anybody else.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> },
) {
  const { messageId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { json, status } = await safeFetchBackend(`${API_URL}/gaitdesk-contact/messages/${messageId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  return NextResponse.json(json, { status });
}
