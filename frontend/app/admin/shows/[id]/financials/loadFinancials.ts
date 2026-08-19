import { getAuthHeaders, API_URL, readJsonBody } from '@/lib/backend-fetch';
import type { ShowFinancials } from '@/lib/financials';

/**
 * `GET /shows/{id}/financials` — the whole money picture for one show.
 *
 * Shared by the Financials overview and the Exhibitors page rather than
 * duplicated in each: both are views onto the same payload, and two loaders
 * would be two chances for the summary tiles and the account rows they drill
 * into to disagree.
 *
 * Returns null on any failure so the caller can render its own "couldn't load
 * this" branch. `readJsonBody` rather than `res.json()`: a backend 500 comes
 * back as plain text and the throw would escape the page, replacing a real
 * status with an opaque parse error.
 */
export async function loadFinancials(showId: string): Promise<ShowFinancials | null> {
  const headers = await getAuthHeaders();
  if (!headers) return null;
  const res = await fetch(`${API_URL}/shows/${showId}/financials`, {
    headers,
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return readJsonBody(res);
}
