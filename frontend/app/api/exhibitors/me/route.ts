import { NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * The caller's own exhibitor row, created if they have none.
 *
 * Role-agnostic on purpose. A show manager who ticked "I also compete" in the
 * post-signup questionnaire gets a row here without their `users.role`
 * changing — the backend already decides exhibitor self-registration on the
 * presence of this row rather than on the role (see `show_registration.py`),
 * so the row is the whole permission.
 */
export async function POST() {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { json, status } = await safeFetchBackend(`${API_URL}/exhibitors/me`, {
    method: 'POST',
    headers,
  });
  return NextResponse.json(json, { status });
}
