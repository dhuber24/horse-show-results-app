import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import { isClassFeeEditorUnit } from '@/lib/fee-units';
import type { WizardStepsInput } from '../../../_wizard/steps';

// Mirrors LODGING_CODES in setup/lodging/page.tsx — `hookup` is the pre-108
// code for the camping line and still counts as lodging that is configured.
const LODGING_CODES = new Set(['stall', 'shavings', 'camping', 'hookup']);

type FeeRow = {
  id: string;
  code: string;
  amount_cents: number;
  unit: string;
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

export async function fetchStepCounts(showId: string): Promise<WizardStepsInput> {
  const [judges, sanctioning, fees, classes, futurities, showbill] = await Promise.all([
    getJson<{ id: string }[]>(`${API_URL}/shows/${showId}/judges/`, []),
    getJson<{ association_id: string }[]>(
      `${API_URL}/shows/${showId}/sanctioning/`,
      [],
    ),
    getJson<FeeRow[]>(`${API_URL}/shows/${showId}/fees/`, []),
    getJson<{ id: string }[]>(`${API_URL}/shows/${showId}/classes/`, []),
    getJson<{ id: string }[]>(`${API_URL}/shows/${showId}/futurities/`, []),
    getJson<ShowbillState>(`${API_URL}/shows/${showId}/showbill-document`, {
      effective_source: 'generated',
    }),
  ]);

  const lodgingFeeCount = fees.filter((f) => LODGING_CODES.has(f.code)).length;
  // A show whose only Step 5 money is a class fee — an office fee, a drug fee
  // per horse, a jackpot line, whatever a manager named — has done the step.
  // Matched by unit rather than by code, because a manager names these
  // themselves and there is no fixed code to look for any more (see
  // CLASS_FEE_EDITOR_UNITS). The office charge is one of these rows since
  // migration 132, so it needs no separate term here.
  const feesDone = fees.some((f) => isClassFeeEditorUnit(f.unit));

  return {
    showId,
    judgeCount: judges.length,
    sanctioningCount: sanctioning.length,
    lodgingFeeCount,
    feesCount: feesDone ? 1 : 0,
    classCount: classes.length,
    futurityCount: futurities.length,
    // An uploaded bill is a bill on its own; a generated one is only a bill once
    // there is a schedule on it. Every show defaults to the generated option, so
    // marking the step done on arrival would make the tick mean nothing.
    showbillReady:
      showbill.effective_source === 'uploaded' || classes.length > 0,
  };
}
