import { fetchShow } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import JudgesEditor, { type KnownJudge } from '../../judges/JudgesEditor';
import StepLayout from '../_lib/StepLayout';
import { fetchStepCounts } from '../_lib/fetchStepCounts';

async function fetchJudges(showId: string, headers: HeadersInit) {
  const res = await fetch(`${API_URL}/shows/${showId}/judges/`, { headers, cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

async function fetchShowTypes(headers: HeadersInit) {
  const res = await fetch(`${API_URL}/show-types/`, { headers, cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

async function fetchKnownJudges(headers: HeadersInit): Promise<KnownJudge[]> {
  const res = await fetch(`${API_URL}/judges/known`, { headers, cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

export default async function SetupJudgesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const headers = await getAuthHeaders();
  const [show, judges, showTypes, knownJudges, stepsInput] = await Promise.all([
    fetchShow(id),
    fetchJudges(id, headers || {}),
    fetchShowTypes(headers || {}),
    fetchKnownJudges(headers || {}),
    fetchStepCounts(id, 0),
  ]);

  return (
    <StepLayout
      showId={id}
      showName={show.name}
      current="judges"
      title="Step 2: Judges"
      subtitle="Add the judges officiating this show. Multiple allowed; you can skip and add later."
      stepsInput={{ ...stepsInput, judgeCount: judges.length }}
    >
      <JudgesEditor
        showId={id}
        initialJudges={judges}
        showTypes={showTypes}
        knownJudges={knownJudges}
      />
    </StepLayout>
  );
}
