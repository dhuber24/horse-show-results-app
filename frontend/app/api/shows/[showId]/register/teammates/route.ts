import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/** Riders at this show whose name matches `q`, to name on a team (migration 192). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ showId: string }> },
) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { showId } = await params;
  const q = new URL(request.url).searchParams.get('q') ?? '';
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/register/teammates?q=${encodeURIComponent(q)}`,
    { headers },
  );
  return NextResponse.json(json, { status });
}
