import { getAuthHeaders, API_URL, readJsonBody } from '@/lib/backend-fetch';
import type { PreviewData } from './types';

/**
 * `GET /shows/{id}/register/preview`, for the two screens that read it — the
 * registration wizard and class registration. One loader so the two cannot
 * disagree about what the exhibitor has or how a refusal is worded.
 */
export async function loadPreview(
  showId: string,
): Promise<{ status: number; data: PreviewData | null; error?: string }> {
  const headers = await getAuthHeaders();
  if (!headers) return { status: 401, data: null };
  const res = await fetch(`${API_URL}/shows/${showId}/register/preview`, {
    headers,
    cache: 'no-store',
  });
  const json = await readJsonBody(res);
  if (!res.ok || json === null) {
    return {
      status: res.status,
      data: null,
      error: json?.detail || json?.error || 'Unable to load registration form',
    };
  }
  return { status: 200, data: json };
}
