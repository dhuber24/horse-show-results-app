import { NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * The id and name of every trainer with an account, for `TrainerSelect` on a
 * horse form. Any signed-in account reaches this, so it reads `/trainers/names`;
 * the whole records are `GET /trainers/`, an admin's, and the admin's pages read
 * them on the server. There is no POST: a trainer is added by signing up.
 */
export async function GET() {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { json, status } = await safeFetchBackend(`${API_URL}/trainers/names`, { headers });
  return NextResponse.json(json, { status });
}
