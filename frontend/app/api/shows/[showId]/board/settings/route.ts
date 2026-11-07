import { NextRequest } from 'next/server';
import { relayToBackend } from '@/lib/backend-fetch';

// The show office opens its board to everybody, to signed-in accounts only, or
// closes it to new posts.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ showId: string }> },
) {
  const { showId } = await params;
  const body = await request.json().catch(() => ({}));
  return relayToBackend(`/shows/${showId}/board/settings`, { method: 'PUT', body });
}
