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
            href: `/shows/${showId}/signup`,
            icon: '✍️',
            title: 'Sign Up',
            description: 'Reserve stalls, shavings and camping, then pick your classes.',
            primary: true,
          },
    );
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

  tiles.push({
    href: `/shows/${showId}/showbill`,
    icon: '📄',
    title: 'Show Bill',
    description: 'Classes, judges, fees and rules — print it or save a PDF.',
  });

  tiles.push({
    href: `/shows/${showId}/details`,
    icon: 'ℹ️',
    title: 'Show Details',
    description: 'Dates, location, show type, clubs — and what you owe.',
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
