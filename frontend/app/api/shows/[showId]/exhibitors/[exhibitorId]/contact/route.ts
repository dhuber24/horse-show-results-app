import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Show staff taking an exhibitor's contact details over the counter — email,
 * telephone, postal address, a youth exhibitor's guardian. Every field is
 * optional; the backend writes them to this show's copy of the exhibitor, never
 * the profile, and the email to the office's own address on the record.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ showId: string; exhibitorId: string }> },
) {
  const { showId, exhibitorId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/exhibitors/${exhibitorId}/contact`,
    { method: 'PATCH', headers, body: JSON.stringify(body) },
  );
  return NextResponse.json(json, { status });
}
