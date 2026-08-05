import { API_URL } from '@/lib/backend-fetch';
import type {
  AssociationOption,
  RegistryJudge,
  ShowJudgeAssignment,
} from './JudgesEditor';

async function getJson<T>(url: string, headers: HeadersInit, fallback: T): Promise<T> {
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) return fallback;
  return res.json();
}

/**
 * Everything the judges step needs: who is already on the show, who the
 * registry knows about, and the associations a new judge can be carded with.
 */
export async function fetchJudgeSetupData(showId: string, headers: HeadersInit) {
  const [judges, registryJudges, associations] = await Promise.all([
    getJson<ShowJudgeAssignment[]>(`${API_URL}/shows/${showId}/judges/`, headers, []),
    getJson<RegistryJudge[]>(`${API_URL}/judges/`, headers, []),
    getJson<AssociationOption[]>(`${API_URL}/associations/`, headers, []),
  ]);
  return { judges, registryJudges, associations };
}
