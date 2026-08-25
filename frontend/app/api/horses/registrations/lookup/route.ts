import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL, safeFetchBackend } from '@/lib/backend-fetch';

export async function GET(req: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const associationId = req.nextUrl.searchParams.get('association_id');
  const registrationNumber = req.nextUrl.searchParams.get('registration_number');
  if (!associationId || !registrationNumber) {
    return NextResponse.json({ error: 'association_id and registration_number are required' }, { status: 400 });
  }

  const qs = new URLSearchParams({ association_id: associationId, registration_number: registrationNumber });
  const { json, status } = await safeFetchBackend(`${API_URL}/horses/registrations/lookup?${qs.toString()}`, { headers });
  if (status === 404) return NextResponse.json(null, { status: 404 });
  return NextResponse.json(json, { status });
}
