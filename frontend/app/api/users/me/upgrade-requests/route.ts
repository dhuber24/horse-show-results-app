import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

/**
 * Ask GaitDesk to switch a paid feature on for one of the caller's show
 * companies (migration 144) — the Request upgrade button on a locked door.
 * The backend stores it for GaitDesk's admins and emails them if it can.
 */
export async function POST(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { json, status } = await safeFetchBackend(`${API_URL}/users/me/upgrade-requests`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return NextResponse.json(json, { status });
}
