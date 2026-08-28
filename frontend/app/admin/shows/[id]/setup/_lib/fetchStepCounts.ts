import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import { isAutomaticUnit } from '@/lib/fee-units';
import type { WizardStepsInput } from '../../../_wizard/steps';

// Mirrors LODGING_CODES in setup/lodging/page.tsx — `hookup` is the pre-108
// code for the camping line and still counts as lodging that is configured.
const LODGING_CODES = new Set(['stall', 'shavings', 'camping', 'hookup']);
// `futurity` is deliberately absent: a futurity is its own programme with its
// own tiered pricing (Step 7), not a single amount on the fee schedule. The code
// still exists on shows set up before migration 107 and is left alone there.
const FEE_CODES = new Set(['standard_class', 'jackpot']);

type FeeRow = {
  id: string;
  code: string;
  amount_cents: number;
  unit: string;
};

async function getJson<T>(url: string, fallback: T): Promise<T> {
  const headers = await getAuthHeaders();
  if (!headers) return fallback;
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) return fallback;
  return res.json();
}

export async function fetchStepCounts(
  showId: string,
  officeChargeCents: number,
): Promise<WizardStepsInput> {
  const [judges, sanctioning, fees, classes, futurities] = await Promise.all([
    getJson<{ id: string }[]>(`${API_URL}/shows/${showId}/judges/`, []),
    getJson<{ association_id: string }[]>(
      `${API_URL}/shows/${showId}/sanctioning/`,
      [],
    ),
    getJson<FeeRow[]>(`${API_URL}/shows/${showId}/fees/`, []),
    getJson<{ id: string }[]>(`${API_URL}/shows/${showId}/classes/`, []),
    getJson<{ id: string }[]>(`${API_URL}/shows/${showId}/futurities/`, []),
  ]);

  const lodgingFeeCount = fees.filter((f) => LODGING_CODES.has(f.code)).length;
  const otherFeeCount = fees.filter((f) => FEE_CODES.has(f.code)).length;
  // A show whose only Step 5 money is its own named charge — a drug fee per
  // horse, say — has done the step. Matched by unit rather than by code,
  // because a manager names these themselves and there is no code to look for.
  const chargeCount = fees.filter((f) => isAutomaticUnit(f.unit)).length;
  const feesDone = otherFeeCount > 0 || chargeCount > 0 || officeChargeCents > 0;

  return {
    showId,
    judgeCount: judges.length,
    sanctioningCount: sanctioning.length,
    lodgingFeeCount,
    feesCount: feesDone ? 1 : 0,
    classCount: classes.length,
    futurityCount: futurities.length,
  };
}
