import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const res = await fetch(`${API_URL}/shows/${showId}/apha-export`, { headers });

  if (!res.ok) {
    const json = await res.json().catch(() => ({ detail: 'Export failed' }));
    return NextResponse.json(json, { status: res.status });
  }

  const csv = await res.text();
  const disposition = res.headers.get('Content-Disposition') ?? `attachment; filename="apha_results_${showId}.csv"`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': disposition,
    },
  });
}
