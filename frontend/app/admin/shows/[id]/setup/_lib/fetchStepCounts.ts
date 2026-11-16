import { cache } from 'react';
import { fetchShow } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import { isClassFeeEditorUnit } from '@/lib/fee-units';
import { registrationAnswered } from '@/lib/registration-window';
import type { SkipKey, WizardStepsInput } from '../../../_wizard/steps';

// Mirrors LODGING_CODES in setup/lodging/page.tsx — `hookup` is the pre-108
// code for the camping line and still counts as lodging that is configured.
const LODGING_CODES = new Set(['stall', 'shavings', 'camping', 'hookup']);

type FeeRow = {
  id: string;
  code: string;
  amount_cents: number;
  unit: string;
};

/** Only what the Judge Cards step turns on. A rail class is placed rather than
 *  scored, so it has no card and does not count towards that step either way. */
type ClassRow = {
  id: string;
  score_type?: string | null;
  judging_system_id?: string | null;
  /** What somebody chose on the Scoring step (migration 155), or null. */
  card_type?: string | null;
  /** How the class is actually placed, derived where nobody chose. */
  effective_card_type?: 'placing' | 'scored' | 'equitation' | 'timed' | null;
};

/** Only the resolved half of `ShowbillOut` is needed here — whether the step is
 *  done turns on what a reader would actually get, not on what the show asked
 *  for. */
type ShowbillState = { effective_source: 'generated' | 'uploaded' };

async function getJson<T>(url: string, fallback: T): Promise<T> {
  const headers = await getAuthHeaders();
  if (!headers) return fallback;
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) return fallback;
  return res.json();
}

/**
 * Ten reads, so memoised for the request: a setup step's page and the desktop
 * sidebar beside it (`@sidebar/`) both need these counts, render in the same
 * request, and would otherwise make all ten twice.
 */
export const fetchStepCounts = cache(async function fetchStepCounts(
  showId: string,
): Promise<WizardStepsInput> {
  const [show, judges, sanctioning, fees, classes, futurities, showbill, sidePots, skips, highPoint] = await Promise.all([
    fetchShow(showId),
    getJson<{ id: string }[]>(`${API_URL}/shows/${showId}/judges/`, []),
    getJson<{ association_id: string }[]>(
      `${API_URL}/shows/${showId}/sanctioning/`,
      [],
    ),
    getJson<FeeRow[]>(`${API_URL}/shows/${showId}/fees/`, []),
    getJson<ClassRow[]>(`${API_URL}/shows/${showId}/classes/`, []),
    getJson<{ id: string }[]>(`${API_URL}/shows/${showId}/futurities/`, []),
    getJson<ShowbillState>(`${API_URL}/shows/${showId}/showbill-document`, {
      effective_source: 'generated',
    }),
    getJson<{ id: string }[]>(`${API_URL}/shows/${showId}/side-pots/`, []),
    // What the office said does not apply (migration 154). A failed read is no
    // skips, which only means nothing is folded away -- never a lost step.
    getJson<{ steps: SkipKey[] }>(`${API_URL}/shows/${showId}/setup-skips`, { steps: [] }),
    getJson<{ point_system: unknown | null }>(`${API_URL}/shows/${showId}/high-point`, { point_system: null }),
  ]);

  const lodgingFeeCount = fees.filter((f) => LODGING_CODES.has(f.code)).length;
  const scoredClasses = classes.filter(
    (c) => c.score_type === 'pattern' || c.score_type === 'time',
  );
  // A show whose only fees-step money is a class fee — an office fee, a drug fee
  // per horse, a jackpot line, whatever a manager named — has done the step.
  // Matched by unit rather than by code, because a manager names these
  // themselves and there is no fixed code to look for any more (see
  // CLASS_FEE_EDITOR_UNITS). The office charge is one of these rows since
  // migration 132, so it needs no separate term here.
  const feesDone = fees.some((f) => isClassFeeEditorUnit(f.unit));

  return {
    showId,
    registrationAnswered: registrationAnswered(show),
    judgeCount: judges.length,
    sanctioningCount: sanctioning.length,
    lodgingFeeCount,
    feesCount: feesDone ? 1 : 0,
    classCount: classes.length,
    futurityCount: futurities.length,
    sidePotCount: sidePots.length,
    highPointChosen: highPoint.point_system != null,
    skippedSteps: skips.steps,
    scoredClassCount: scoredClasses.length,
    cardedClassCount: scoredClasses.filter((c) => c.judging_system_id).length,
    scoringChosenCount: classes.filter((c) => c.card_type).length,
    cardTypeCounts: classes.reduce(
      (acc, c) => {
        const key = c.effective_card_type ?? 'placing';
        acc[key] += 1;
        return acc;
      },
      { placing: 0, scored: 0, equitation: 0, timed: 0 },
    ),
    // Coggins is on unless the show turns it off; a CVI and vaccination records
    // are off unless it turns them on. Counted rather than listed because the
    // hub prints one line per step.
    healthPaperCount: [
      show.requires_coggins ?? true,
      show.requires_health_certificate ?? false,
      show.requires_vaccination ?? false,
    ].filter(Boolean).length,
    // An uploaded bill is a bill on its own; a generated one is only a bill once
    // there is a schedule on it. Every show defaults to the generated option, so
    // marking the step done on arrival would make the tick mean nothing.
    showbillReady:
      showbill.effective_source === 'uploaded' || classes.length > 0,
  };
});
