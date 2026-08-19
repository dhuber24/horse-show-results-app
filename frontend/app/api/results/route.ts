import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, safeFetchBackend, API_URL } from '@/lib/backend-fetch';

// Every verb here goes through safeFetchBackend rather than res.json(): a
// backend 500 comes back as plain text, and an unguarded parse throws over the
// top of the real error. The scribe screens autosave, so this route is hit
// constantly and a swallowed error is one the scribe never learns about.

export async function POST(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { showId, classId, ...data } = body;
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/classes/${classId}/results/`,
    { method: 'POST', headers, body: JSON.stringify(data) },
  );
  return NextResponse.json(json, { status });
}

export async function PUT(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  // judgeId names whose card is being replaced (migration 095) and decides the
  // delete scope on the backend. It must survive the hop verbatim, including
  // when it is null — that is the unattributed card, not a missing value.
  const { showId, classId, judgeId, ...data } = body;
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/classes/${classId}/results/`,
    {
      method: 'PUT',
      headers,
      body: JSON.stringify({ ...data, judge_id: judgeId ?? null }),
    },
  );
  return NextResponse.json(json, { status });
}

export async function PATCH(request: NextRequest) {
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { showId, classId, resultId, ...data } = body;
  const { json, status } = await safeFetchBackend(
    `${API_URL}/shows/${showId}/classes/${classId}/results/${resultId}`,
    { method: 'PATCH', headers, body: JSON.stringify(data) },
  );
  return NextResponse.json(json, { status });
}
