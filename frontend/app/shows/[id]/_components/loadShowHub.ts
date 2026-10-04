import { auth } from '@/auth';
import { fetchShow, fetchMyShowStanding } from '@/lib/api';
import { getAuthHeaders } from '@/lib/backend-fetch';
import { canActAsExhibitor } from '@/lib/exhibitor-access';
import type { MyShowStanding } from '@/lib/my-shows';

/**
 * Everything `ShowHub` renders from, for the two routes that render it —
 * `/shows/[id]` and `/shows/[id]/live`. One loader, so the show's own page and
 * the public results hub cannot come to disagree about who is reading.
 *
 * Nothing here reads the class list: the hub's tiles are the same whatever
 * the show holds, and the schedule is a page of its own.
 */
export async function loadShowHub(showId: string) {
  const session = await auth();
  // Having an exhibitor record is what lets somebody enter a show — the same
  // test `show_registration.py` applies. A show manager who also competes
  // holds one account.
  const canSelfRegister = session ? await canActAsExhibitor() : false;
  const headers = canSelfRegister ? await getAuthHeaders() : null;
  const [show, standing] = await Promise.all([
    fetchShow(showId),
    // Only an exhibitor has a standing to report, and only they see what it
    // feeds — nobody else pays for the round trip.
    canSelfRegister
      ? (fetchMyShowStanding(showId, headers || undefined) as Promise<MyShowStanding | null>)
      : Promise.resolve(null),
  ]);
  return { showId, show, signedIn: Boolean(session), canSelfRegister, standing };
}
