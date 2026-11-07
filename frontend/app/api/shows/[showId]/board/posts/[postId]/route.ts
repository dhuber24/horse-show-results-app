import { NextRequest } from 'next/server';
import { relayToBackend } from '@/lib/backend-fetch';

type Params = { params: Promise<{ showId: string; postId: string }> };

// The show office hides, unhides or pins a post.
export async function PATCH(request: NextRequest, { params }: Params) {
  const { showId, postId } = await params;
  const body = await request.json().catch(() => ({}));
  return relayToBackend(`/shows/${showId}/board/posts/${postId}`, { method: 'PATCH', body });
}

// The author takes their own post down. Signed in only: nothing ties a
// visitor's post to them.
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { showId, postId } = await params;
  return relayToBackend(`/shows/${showId}/board/posts/${postId}`, { method: 'DELETE' });
}
