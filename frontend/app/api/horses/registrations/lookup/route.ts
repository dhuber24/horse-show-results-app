import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

export async function GET(req: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const showTypeId = req.nextUrl.searchParams.get('show_type_id');
  const registrationNumber = req.nextUrl.searchParams.get('registration_number');
  if (!showTypeId || !registrationNumber) {
    return NextResponse.json({ error: 'show_type_id and registration_number are required' }, { status: 400 });
  }

  const qs = new URLSearchParams({ show_type_id: showTypeId, registration_number: registrationNumber });
  const res = await fetch(`${API_URL}/horses/registrations/lookup?${qs.toString()}`, { headers });
  if (res.status === 404) return NextResponse.json(null, { status: 404 });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
