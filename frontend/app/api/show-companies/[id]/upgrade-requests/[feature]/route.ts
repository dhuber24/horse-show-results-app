import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Dismiss a show company's request for a paid feature without switching it on
 * (migration 144). Switching the feature on answers it, through
 * `../../features/[feature]`.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; feature: string }> },
) {
  const { id, feature } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { json, status } = await safeFetchBackend(
    `${API_URL}/show-companies/${id}/upgrade-requests/${encodeURIComponent(feature)}`,
    { method: 'DELETE', headers },
  );
  return NextResponse.json(json, { status });
}
