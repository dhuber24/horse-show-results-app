import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Take a horse off this show's registration. It stays on the exhibitor's
 * profile and on every other show's registration — this used to drop the
 * profile's own link, which is the bug migration 145 fixed.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ showId: string; horseId: string }> },
) {
  const { showId, horseId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/register/horses/${horseId}`,
    { method: 'DELETE', headers },
  );
  if (status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(json, { status });
}
