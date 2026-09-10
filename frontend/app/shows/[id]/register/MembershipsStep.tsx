'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ExhibitorRegistrations, { type Registration } from '@/components/ExhibitorRegistrations';
import type { ProfileChecklistItem } from './types';

/**
 * Step two: the exhibitor's own association cards.
 *
 * **Edited here rather than linked out to**, for the same reason step one puts
 * the contact boxes on the page instead of a link to `/profile`: bouncing
 * somebody out of a registration they are half-way through, on a phone, is how
 * people lose their place and do not come back. This used to be a line at the
 * bottom of step one reading "Add my numbers →" — which is exactly the trip
 * this screen exists to avoid, and one that dropped them on a tab with no way
 * back to the show they were registering for.
 *
 * **It is a step, and it still blocks nothing.** `exhibitor_profile.py` marks
 * the membership row advisory and `PUT /signup` does not refuse over it —
 * a membership number is a claim the desk verifies against a card, and one can
 * be bought at the counter, so gating an entry on it would refuse somebody for
 * a thing the show itself can fix in thirty seconds. So the horses step stays
 * available whether or not anything here is filled in, and the wizard does not
 * open on this step: `initialStep` skips it, because opening on an optional
 * step reads as a requirement.
 *
 * The picker offers every association, not only the ones this show runs under.
 * Somebody who holds an AQHA card at an APHA show should be able to file it
 * while they are here; what the show is waiting on is said in the line above
 * the list, which is the backend's own checklist hint.
 */
export default function MembershipsStep({
  exhibitorId,
  registrations,
  item,
}: {
  exhibitorId: string;
  registrations: Registration[];
  /** The `memberships` row from the profile checklist — which associations
   *  this show runs under and whether a number is on file for each. Absent
   *  when the show has no breed or club affiliation at all, in which case this
   *  step is not rendered. */
  item: ProfileChecklistItem;
}) {
  const router = useRouter();

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm" style={{ color: item.complete ? 'var(--success)' : 'var(--foreground)' }}>
          {item.hint}
        </p>
        {!item.complete && (
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
            Optional — you can carry on without it. The show office checks cards at the desk, and
            most associations will sell you a membership there.
          </p>
        )}
      </div>

      <ExhibitorRegistrations
        exhibitorId={exhibitorId}
        initialRegistrations={registrations}
        // The checklist and the stepper's tick are both server-rendered, so a
        // refresh is what re-ticks this step. Fires on an add, an edit or a
        // removal — never on a keystroke — and the list below keeps its own
        // state, so nothing being typed is thrown away by it.
        onRegistrationsChanged={() => router.refresh()}
      />

      {/* A competition card is not a membership — it says which division you
          may enter, and it is bought again every January. Linked rather than
          asked for here: nothing on an entry is refused over one, and a second
          list under this one would make an optional step look like two.
          Continuing is the section's own Next button below, so there is no
          second one here. */}
      <Link
        href="/profile?tab=memberships"
        className="text-sm hover:underline inline-block"
        style={{ color: 'var(--accent)' }}
      >
        Competition cards →
      </Link>
    </div>
  );
}
