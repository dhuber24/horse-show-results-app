import { fetchShow, fetchClasses } from '@/lib/api';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';
import StepLayout from '../../setup/_lib/StepLayout';
import { fetchStepCounts } from '../../setup/_lib/fetchStepCounts';
import JudgingClassesClient, {
  type JudgingSystemOption,
  type ScoredClass,
} from './JudgingClassesClient';

async function fetchJudgingSystems(
  showType: string | null,
  headers: HeadersInit,
): Promise<JudgingSystemOption[]> {
  const query = showType ? `?show_type=${encodeURIComponent(showType)}` : '';
  const res = await fetch(`${API_URL}/judging-systems/${query}`, {
    headers,
    cache: 'no-store',
  });
  if (!res.ok) return [];
  return (await readJsonBody(res)) ?? [];
}

/**
 * Setup Step 8: which card each scored class is marked on.
 *
 * A step rather than a yellow notice at the top of the Class Builder. It is a
 * per-class designation made *once the schedule exists*, like club sanctioning
 * and like a futurity's class list — and the screen is also the only place the
 * card shapes are explained, which a secretary choosing between three of them
 * needs in front of them. A banner above the class wizard could say none of
 * that; it could only link away from the screen somebody had just opened.
 *
 * The route is unchanged, the same way Step 1 stays on `/edit` and Step 4 on
 * `/classes`: a step is a position in the flow, not a folder.
 *
 * Only pattern and timed classes appear. A rail class is placed, not scored,
 * and there is no card to mark.
 */
export default async function JudgingClassesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const headers = await getAuthHeaders();
  const [show, classes, stepsInput] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchStepCounts(id),
  ]);
  const systems = await fetchJudgingSystems(show.show_type_code ?? null, headers || {});

  const scored = (classes as ScoredClass[]).filter(
    (c) => c.score_type === 'pattern' || c.score_type === 'time',
  );

  return (
    <StepLayout
      showId={id}
      showName={show.name}
      current="judgecards"
      title="Step 8: Judge Cards"
      subtitle="How each scored class is marked. Give a class a card and the scribe records the maneuvers and penalties the judge calls; the total comes from those rather than being worked out on paper and typed in. Leave it unset and the class scores exactly as it does today."
      stepsInput={stepsInput}
      skipLabel="Skip — score by total"
    >
      <JudgingClassesClient showId={id} classes={scored} systems={systems} />
    </StepLayout>
  );
}
