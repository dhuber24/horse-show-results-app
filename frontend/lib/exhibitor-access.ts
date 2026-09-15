import { cache } from 'react';
import { auth } from '@/auth';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

/**
 * Can this caller act as an exhibitor — enter shows, keep horses, read a bill?
 *
 * **The exhibitor row is the permission, not `users.role`.** The backend has
 * always decided it that way: `show_registration._exhibitor_for_user` looks up
 * `Exhibitor.user_id` and 403s when there is none, and `my_shows` reads the
 * same row. The frontend was the half that asked `role === 'EXHIBITOR'`, which
 * is a narrower question and the wrong one — a show manager who competes at
 * other people's shows holds one account, one role, and an exhibitor record.
 *
 * A user has exactly one `role` and that has not changed. What changed is that
 * ticking "I also compete" in the post-signup questionnaire creates the row
 * (`POST /exhibitors/me`), and every exhibitor surface now reads the row.
 *
 * Deliberately **not** a flag on the session token. The JWT is minted at
 * sign-in, so a manager who ticked the box would keep a stale `false` until
 * they signed out and back in — on the screen they were sent to immediately
 * afterwards. The cost of asking the backend instead is one lookup, memoised
 * per request by `cache()`: the navbar and the page under it share an answer
 * rather than each paying for one, and a page that needs the row itself gets
 * it from the same call that decided the navbar link.
 */
export interface ExhibitorRecord {
  id: string;
  full_name: string;
  date_of_birth: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  parent_guardian_name: string | null;
  parent_guardian_phone: string | null;
}

/** The signed-in user's exhibitor record, or null if they have none.
 *
 *  Null is the ordinary answer for a scribe, a gate steward, or a manager who
 *  did not tick the box — never an error, so callers branch on it rather than
 *  catching. A backend that is down also reads as null here: the fallback is
 *  the screen an exhibitor-less user would have seen anyway, which is the safe
 *  direction to fail in. */
export const loadExhibitor = cache(async (): Promise<ExhibitorRecord | null> => {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return null;

  const headers = await getAuthHeaders();
  if (!headers) return null;

  try {
    const res = await fetch(`${API_URL}/exhibitors/by-user/${userId}`, {
      headers,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as ExhibitorRecord;
  } catch {
    return null;
  }
});

/** Whether the signed-in user can act as an exhibitor at all.
 *
 *  For the several screens that only need the yes/no and never touch the row. */
export async function canActAsExhibitor(): Promise<boolean> {
  return (await loadExhibitor()) !== null;
}
