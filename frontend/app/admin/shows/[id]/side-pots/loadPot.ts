import { getAuthHeaders, API_URL, readJsonBody } from '@/lib/backend-fetch';
import type {
  PotEntry,
  Payout,
  RosterEntry,
  SidePot,
  Standings,
} from './pot-shared';

/**
 * Server-side reads for the side pot screens.
 *
 * The pot hub and its three sub-screens each need a different slice of the pot,
 * so these are separate loaders rather than one payload every page pulls: the
 * Settings screen has no use for standings, and the Standings screen has no use
 * for the entry list. Shared here so the auth headers and the `readJsonBody`
 * guard are written once — a backend 500 comes back as plain text, and
 * `res.json()` on it would replace the page's own "couldn't load this" branch
 * with an opaque parse error.
 *
 * All of these return null (or an empty list) on failure, letting the caller
 * decide between `notFound()` and rendering an empty state.
 */
async function potFetch(path: string): Promise<any> {
  const headers = await getAuthHeaders();
  if (!headers) return null;
  const res = await fetch(`${API_URL}${path}`, { headers, cache: 'no-store' });
  if (!res.ok) return null;
  return readJsonBody(res);
}

export async function loadPots(showId: string): Promise<SidePot[]> {
  return (await potFetch(`/shows/${showId}/side-pots/`)) ?? [];
}

export async function loadPot(
  showId: string,
  potId: string,
): Promise<SidePot | null> {
  return potFetch(`/shows/${showId}/side-pots/${potId}`);
}

export async function loadPotEntries(
  showId: string,
  potId: string,
): Promise<PotEntry[]> {
  return (await potFetch(`/shows/${showId}/side-pots/${potId}/entries`)) ?? [];
}

export async function loadPotRoster(
  showId: string,
  potId: string,
): Promise<RosterEntry[]> {
  return (await potFetch(`/shows/${showId}/side-pots/${potId}/roster`)) ?? [];
}

export async function loadPotStandings(
  showId: string,
  potId: string,
): Promise<Standings | null> {
  return potFetch(`/shows/${showId}/side-pots/${potId}/standings`);
}

export async function loadPotPayouts(
  showId: string,
  potId: string,
): Promise<Payout[]> {
  return (await potFetch(`/shows/${showId}/side-pots/${potId}/payouts`)) ?? [];
}
