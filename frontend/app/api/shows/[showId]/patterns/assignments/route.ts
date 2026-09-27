import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Pointing classes at a pattern, or at none — a row on the office's class list,
 * or a discipline's "set all". Answers with **every** pattern, because the
 * patterns those classes left have changed too.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/patterns/assignments`,
    { method: 'PUT', headers, body: JSON.stringify(body) },
  );
  return NextResponse.json(json, { status });
}
