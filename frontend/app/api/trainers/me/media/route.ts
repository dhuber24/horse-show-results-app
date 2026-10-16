import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { API_URL, getAuthHeaders, safeFetchBackend } from '@/lib/backend-fetch';
import { errorMessage } from '@/lib/api-error';

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';
const TYPES = new Set(['HEADSHOT', 'LOGO', 'PHOTO']);

/**
 * Upload one of the signed-in trainer's own pictures — a logo or a gallery
 * photo for their registry listing. The headshot keeps its own route
 * (`/api/trainers/me/photo`); both land in `trainer_documents`.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  const authHeaders = await getAuthHeaders();
  if (!session?.user || !authHeaders) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json: me, status: meStatus } = await safeFetchBackend(`${API_URL}/trainers/me`, {
    headers: authHeaders,
    cache: 'no-store',
  });
  if (meStatus !== 200 || typeof me?.id !== 'string') {
    return NextResponse.json({ error: 'Trainer profile not found' }, { status: meStatus === 200 ? 404 : meStatus });
  }

  const incoming = await request.formData();
  const file = incoming.get('file');
  const documentType = String(incoming.get('document_type') ?? '');
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'Choose a picture to upload.' }, { status: 400 });
  if (!TYPES.has(documentType)) return NextResponse.json({ error: 'Unknown picture type.' }, { status: 400 });

  const forward = new FormData();
  forward.append('file', file);
  forward.append('document_type', documentType);
  const { json, status } = await safeFetchBackend(`${API_URL}/trainers/${me.id}/documents`, {
    method: 'POST',
    // No Content-Type: the FormData boundary is set by fetch.
    headers: {
      'X-API-Key': INTERNAL_API_KEY,
      'X-User-Id': session.user.id,
      'X-User-Role': session.user.role,
    },
    body: forward,
  });
  if (status >= 400) return NextResponse.json({ error: errorMessage(json, 'Upload failed.') }, { status });
  return NextResponse.json(json, { status });
}
