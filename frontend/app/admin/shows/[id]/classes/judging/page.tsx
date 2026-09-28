import { auth } from '@/auth';
import { fetchAssociations, fetchClasses, fetchPointSystems, fetchShow } from '@/lib/api';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';
import type { PointSystem } from '@/lib/high-point';
import StepLayout from '../../setup/_lib/StepLayout';
import { fetchStepCounts } from '../../setup/_lib/fetchStepCounts';
import { DeclineFeature } from '../../setup/_lib/SkipStep';
import { buildSteps, featureDeclined } from '../../../_wizard/steps';
import ShowPointChart, { type AssociationOption } from '../../high-point/ShowPointChart';
import ClassScoringClient, { type ScoringClass, type SheetOption } from './ClassScoringClient';

async function fetchJudgingSystems(
  showType: string | null,
  headers: HeadersInit,
): Promise<SheetOption[]> {
  const query = showType ? `?show_type=${encodeURIComponent(showType)}` : '';
  const res = await fetch(`${API_URL}/judging-systems/${query}`, {
    headers,
    cache: 'no-store',
  });
  if (!res.ok) return [];
  return (await readJsonBody(res)) ?? [];
}

/** The chart the show scores its high point by, without the standings. */
async function fetchShowPointSystem(showId: string, headers: HeadersInit): Promise<PointSystem | null> {
  const res = await fetch(`${API_URL}/shows/${showId}/high-point`, { headers, cache: 'no-store' });
  if (!res.ok) return null;
  return ((await readJsonBody(res)) as { point_system: PointSystem | null } | null)?.point_system ?? null;
}

/**
 * Setup step, Scoring: how each class is placed, and what its placings are worth.
 *
 * **Scoring** — every class, and which of the four card types places it
 * (migration 155): Placing Cards, Scored / Numeric Cards, Equitation / Pattern
 * Cards, or Timed; and for the two score-based ones, which judge's-card sheet
 * the scribe fills in, if any. Set in bulk — see `ClassScoringClient`. It was
 * *Judge Cards* and listed only pattern and timed classes, but a rail class is
 * placed by a card too, so every class is here. A step rather than a notice at
 * the top of the Class Builder: it is a per-class designation made *once the
 * schedule exists*, like club sanctioning and like a futurity's class list.
 *
 * **High Point** — the chart the show's leaderboard scores posted placings by
 * (migrations 147, 153). It shares the step because it is the other half of the
 * same question and is decided at the same moment: set once, before the show,
 * and read every time a class is posted. The same `ShowPointChart` renders on
 * the High Point page, which the dashboard tile still opens — one
 * implementation, two doors, like Paperwork. It comes first on the page: it is
 * a few lines, and the class list is one row per class.
 *
 * Each half is declined on its own (migration 154): the derived card types are
 * the ordinary case, and plenty of shows run no high point. Declining the high
 * point greys out its dashboard tile; skipping the whole step declines both.
 *
 * The route is unchanged, the same way Step 1 stays on `/edit` and Step 4 on
 * `/classes`: a step is a position in the flow, not a folder.
 */
export default async function ScoringStepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === 'ADMIN';
  const headers = (await getAuthHeaders()) || {};
  const [show, classes, stepsInput, templates, current, associations] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchStepCounts(id),
    fetchPointSystems(headers),
    fetchShowPointSystem(id, headers),
    fetchAssociations(headers).catch(() => [] as AssociationOption[]),
  ]);
  const sheets = await fetchJudgingSystems(show.show_type_code ?? null, headers);

  const counts = { ...stepsInput, highPointChosen: current != null };
  const stepSkipped = buildSteps(counts).find((s) => s.key === 'judgecards')?.skipped ?? false;
  const card = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)' } as const;

  return (
    <StepLayout
      showId={id}
      showName={show.name}
      current="judgecards"
      title="Scoring"
      subtitle="How each class is placed, and what a placing is worth on the show's high-point leaderboard. Every class starts on the card its discipline implies — rail classes placed, pattern classes scored, speed events timed — and a show with no points chart has no leaderboard."
      stepsInput={counts}
      skip={
        counts.scoringChosenCount === 0 && counts.cardedClassCount === 0 && current == null
          ? {
              label: 'Skip — keep the default scoring, no high point',
              note: 'Every class keeps the card its discipline implies, and the scribe types each judge’s total.',
            }
          : undefined
      }
    >
      <div className="space-y-6">
        <section className="border rounded-lg p-4 space-y-4" style={card}>
          <div className="space-y-2">
            <h2 className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>High Point</h2>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              Every class adds to the public leaderboard as soon as its placings are posted, scored by
              this chart. Start from an association&apos;s chart or from scratch, and change any number
              for this show. Each judge&apos;s card counts on its own.
            </p>
            {current == null && !stepSkipped && (
              <DeclineFeature
                showId={id}
                feature="highpoint"
                declined={featureDeclined(counts, 'highpoint')}
                question="Not running a high point at this show?"
                action="No high point at this show"
                tile="High Point"
              />
            )}
          </div>
          <ShowPointChart
            showId={id}
            showName={show.name}
            templates={templates}
            current={current}
            associations={(associations as AssociationOption[]).map((a) => ({ id: a.id, code: a.code, name: a.name }))}
            isAdmin={isAdmin}
          />
        </section>

        <section className="border rounded-lg p-4 space-y-4" style={card}>
          <div className="space-y-1">
            <h2 className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>Scoring</h2>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              Which card places each class. Tick several and apply a card type to all of them at once,
              or change one on its own row.
            </p>
          </div>
          <ClassScoringClient showId={id} classes={classes as ScoringClass[]} sheets={sheets} />
        </section>
      </div>
    </StepLayout>
  );
}
