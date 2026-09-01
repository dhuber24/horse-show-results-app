import Link from 'next/link';
import type { MyShowStanding } from '@/lib/my-shows';
import ExhibitorStatusBanner from './ExhibitorStatusBanner';
import ShowHubHeader from './ShowHubHeader';

/**
 * What a signed-in exhibitor sees when they open a show.
 *
 * This used to be the full class list. That is the wrong first screen for
 * someone deciding whether to enter: a wall of forty class numbers answers a
 * question they have not asked yet, and buries the four they *are* asking —
 * what is this show, what does it cost, when does my class run, and how do I
 * get in. The class list is one tile away, on the schedule screen built for it.
 *
 * Scoring staff keep the old list on this route, because for them the class
 * numbers *are* the menu — each one is a link into a scribe screen.
 *
 * The tiles are ordered about-me first: what I entered, what I owe, then the
 * show-wide screens. A menu that opens with the schedule makes an exhibitor
 * read past the show to find themselves.
 */

type Tile = {
  href: string;
  icon: string;
  title: string;
  description: string;
  primary?: boolean;
};

export default function ExhibitorShowHub({
  showId,
  show,
  standing,
  classCount,
  canSelfRegister,
}: {
  showId: string;
  show: {
    name: string;
    venue?: string | null;
    start_date: string;
    end_date: string;
    status: string;
    affiliations?: { show_type_id: string; show_type_code: string; show_type_name?: string }[];
  };
  standing: MyShowStanding | null;
  classCount: number;
  canSelfRegister: boolean;
}) {
  const registrationOpen = show.status === 'PUBLISHED';
  const signedUp = standing?.signed_up ?? false;
  // Signed up, or entered by the office without signing up — either way there
  // is an account at this show to read. Somebody with neither has no bill, and
  // a tile promising one would open on "nothing here".
  const hasStanding = signedUp || (standing?.entry_count ?? 0) > 0;
  const resultsWorthShowing = show.status === 'ACTIVE' || show.status === 'COMPLETED';

  const tiles: Tile[] = [];

  // Sign-up first and styled as the primary action while it is the thing to
  // do. Once they are in, the same slot becomes the way back to what they
  // entered — same position, so it doesn't move under them mid-show.
  if (canSelfRegister && registrationOpen) {
    tiles.push(
      signedUp
        ? {
            href: `/shows/${showId}/register`,
            icon: '📝',
            title: 'My Registration',
            description: 'Add or drop classes, change the horse you entered.',
            primary: true,
          }
        : {
            // The whole flow in order, on one screen — profile, then stalls,
            // then classes. `/signup` is still a real page and still where
            // releases are signed, but sending a first-time exhibitor there
            // starts them at step two.
            href: `/shows/${showId}/register`,
            icon: '✍️',
            title: 'Sign Up',
            description:
              'Fill in your profile, reserve stalls, shavings and camping, then pick your classes.',
            primary: true,
          },
    );
  }

  // Straight off the show menu rather than buried on Show Details. "What do I
  // owe" is one of the four questions this page exists to answer, and it was a
  // click deeper than "when does my class run". Kept next to My Registration:
  // these two are the tiles about *them*, and everything below is about the
  // show. Not gated on registration being open — the bill outlives it, and
  // "you charged me for four stalls" is a question that arrives after the
  // weekend.
  if (canSelfRegister && hasStanding) {
    tiles.push({
      href: `/shows/${showId}/my-bill`,
      icon: '🧾',
      title: 'What I Owe',
      description: 'Class fees, stalls, shavings and the office charge, itemised.',
    });
  }

  tiles.push({
    href: `/shows/${showId}/schedule`,
    icon: '📋',
    title: 'Class Schedule',
    description:
      classCount > 0
        ? `All ${classCount} classes by day and ring.`
        : 'Classes by day and ring, once they are posted.',
  });

  // Show Bill was a tile of its own, next to this one, opening on a page whose
  // first section restated the dates, venue, show type and clubs that Show
  // Details already carries. Two tiles, two clicks, one answer. The bill now
  // renders below the facts on Show Details, and the printable copy is a link
  // at the foot of it — print is a real errand, but it is not a menu item.
  // Always offered, registered or not. What a show is, who is judging it, what
  // runs when and what it costs are the questions somebody asks *before*
  // deciding to enter, so gating them behind a registration would hide the
  // page at exactly the moment it is useful.
  tiles.push({
    href: `/shows/${showId}/details`,
    icon: 'ℹ️',
    title: 'Show Details',
    description: 'Dates, location, clubs, judges, the class schedule and the fee schedule.',
  });

  if (resultsWorthShowing) {
    tiles.push({
      href: `/shows/${showId}/results`,
      icon: '🏆',
      title: 'Results',
      description: 'Posted placings as classes finish.',
    });
  }

  tiles.push({
    href: `/shows/${showId}/contact`,
    icon: '✉️',
    title: 'Message the Show Office',
    description: 'Ask the secretary a question about this show.',
  });

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <ShowHubHeader show={show} backHref="/" backLabel="Back to Shows" />

      {canSelfRegister && (
        <ExhibitorStatusBanner showId={showId} showStatus={show.status} standing={standing} />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {tiles.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            className="block p-5 rounded-lg border transition hover:shadow-md"
            style={
              tile.primary
                ? { backgroundColor: '#8b4513', borderColor: '#8b4513' }
                : { backgroundColor: '#ffffff', borderColor: '#d4b896' }
            }
          >
            <div className="text-3xl mb-2" aria-hidden="true">{tile.icon}</div>
            <div
              className="font-semibold text-lg"
              style={{ color: tile.primary ? '#ffffff' : '#2c1810' }}
            >
              {tile.title}
            </div>
            <div
              className="text-sm mt-1"
              style={{ color: tile.primary ? '#f0e8d8' : '#8b7355' }}
            >
              {tile.description}
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
