import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import type { WizardStepsInput } from '../../../_wizard/steps';

const LODGING_CODES = new Set(['stall', 'shavings', 'camping']);
const FEE_CODES = new Set(['standard_class', 'jackpot', 'futurity']);

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
  const [judges, sanctioning, fees] = await Promise.all([
    getJson<{ id: string }[]>(`${API_URL}/shows/${showId}/judges/`, []),
    getJson<{ sanctioned_association_id: string }[]>(
      `${API_URL}/shows/${showId}/sanctioning/`,
      [],
    ),
    getJson<FeeRow[]>(`${API_URL}/shows/${showId}/fees/`, []),
  ]);

  const lodgingFeeCount = fees.filter((f) => LODGING_CODES.has(f.code)).length;
  const otherFeeCount = fees.filter((f) => FEE_CODES.has(f.code)).length;
  const feesDone = otherFeeCount > 0 || officeChargeCents > 0;

  return {
    showId,
    judgeCount: judges.length,
    sanctioningCount: sanctioning.length,
    lodgingFeeCount,
    feesCount: feesDone ? 1 : 0,
  };
}
