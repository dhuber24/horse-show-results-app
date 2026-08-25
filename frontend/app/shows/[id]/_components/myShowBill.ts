import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import type { MyShow, MyShowsData } from '@/lib/my-shows';

/**
 * What one show costs the signed-in exhibitor, or null when they have no
 * standing at it.
 *
 * Reads `GET /my-shows/` and picks this show out of it rather than asking for a
 * per-show total. That is one extra row or two over the wire and buys the thing
 * that matters: the number is byte-for-byte the number on My Shows, because it
 * is the same payload. A second endpoint summing the same fees would be faster
 * and would eventually disagree — the argument `billing.build_bill` exists to
 * settle (see Claude.md).
 *
 * Kept out of the page so the next screen that needs one show's bill reads it
 * the same way, rather than growing a second endpoint that sums the same fees.
 */
export async function loadMyShowBill(showId: string): Promise<MyShow | null> {
  const headers = await getAuthHeaders();
  if (!headers) return null;
  const res = await fetch(`${API_URL}/my-shows/`, { headers, cache: 'no-store' });
  if (!res.ok) return null;
  const data: MyShowsData = await res.json();
  return data.shows.find((s) => s.show_id === showId) ?? null;
}
