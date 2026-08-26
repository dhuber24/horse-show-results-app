import { getAuthHeaders, API_URL, readJsonBody } from '@/lib/backend-fetch';
import type { Futurity, FuturityEntry, Standings } from './futurity-shared';

/**
 * Server-side reads for the futurity screens.
 *
 * Separate loaders rather than one payload every page pulls: Settings has no
 * use for standings and Standings has no use for the entry list. Shared here so
 * the auth headers and the `readJsonBody` guard are written once — a backend
 * 500 comes back as plain text, and `res.json()` on it would replace the page's
 * own "couldn't load this" branch with an opaque parse error.
 *
 * All return null (or an empty list) on failure, letting the caller choose
 * between `notFound()` and an empty state.
 */
async function futurityFetch(path: string): Promise<any> {
  const headers = await getAuthHeaders();
  if (!headers) return null;
  const res = await fetch(`${API_URL}${path}`, { headers, cache: 'no-store' });
  if (!res.ok) return null;
  return readJsonBody(res);
}

export async function loadFuturities(showId: string): Promise<Futurity[]> {
  return (await futurityFetch(`/shows/${showId}/futurities/`)) ?? [];
}

export async function loadFuturity(
  showId: string,
  futurityId: string,
): Promise<Futurity | null> {
  return futurityFetch(`/shows/${showId}/futurities/${futurityId}`);
}

export async function loadFuturityEntries(
  showId: string,
  futurityId: string,
): Promise<FuturityEntry[]> {
  return (await futurityFetch(`/shows/${showId}/futurities/${futurityId}/entries`)) ?? [];
}

export async function loadFuturityStandings(
  showId: string,
  futurityId: string,
  divisionId: string,
): Promise<Standings | null> {
  return futurityFetch(
    `/shows/${showId}/futurities/${futurityId}/divisions/${divisionId}/standings`,
  );
}
