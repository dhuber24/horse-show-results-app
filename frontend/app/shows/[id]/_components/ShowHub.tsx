import Link from 'next/link';
import type { MyShowStanding } from '@/lib/my-shows';
import { buildShowHub, type HubTile } from '@/lib/show-hub';
import ExhibitorStatusBanner from './ExhibitorStatusBanner';
import ShowHubHeader from './ShowHubHeader';

/**
 * A show's main page — the public results hub — for everybody, signed in or
 * not. `/shows/[id]` renders it for all but a scribe or an admin while the show
 * runs, whose class numbers *are* their menu; `/shows/[id]/live` renders it for
 * everyone, which is how the office's *Public Results* tile shows staff what
 * the public sees.
 *
 * The show's sections and the show office are the same block for every reader,
 * whatever the show's status. An exhibitor's own standing and tiles go above
 * it, in a grid of their own, so the show's tiles never move between one reader
 * and the next. What goes where, and why, is `lib/show-hub.ts`.
 *
 * No class list: somebody opening a show is deciding whether to enter, or
 * looking for one class, and the schedule is one tile away on a screen built
 * for it.
 */
export default function ShowHub({
  showId,
  show,
  signedIn,
  canSelfRegister,
  standing,
}: {
  showId: string;
  show: {
    name: string;
    venue?: string | null;
    start_date: string;
    end_date: string;
    status: string;
    /** The show office's two registration answers (migration 159), and whether
     *  sign-up is still open today — decided on the server. */
    signup_open?: boolean;
    entry_deadline?: string | null;
    self_entry_closes?: string | null;
    affiliations?: { show_type_id: string; show_type_code: string; show_type_name?: string }[];
  };
  signedIn: boolean;
  canSelfRegister: boolean;
  standing: MyShowStanding | null;
}) {
  const hub = buildShowHub(showId, show, { signedIn, canSelfRegister, standing });
  // Back to this show once they are in — where a returning exhibitor's own
  // tiles are waiting — not to the home page, having forgotten which show it was.
  const returnTo = encodeURIComponent(`/shows/${showId}`);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <ShowHubHeader show={show} backHref={hub.back.href} backLabel={hub.back.label} />

      {hub.statusBanner && (
        <ExhibitorStatusBanner
          showId={showId}
          showStatus={show.status}
          standing={standing}
          signupOpen={show.signup_open !== false}
        />
      )}

      {/* While the show is taking entries it is the registration flow; once it
          is past the last day to sign up online, or under way, the show
          office's contact form, because the office may still take a late entry
          at the counter (`lib/show-signup.ts`). */}
      {hub.signUp && (
        <Link
          href={hub.signUp.href}
          className="block mb-3 p-4 rounded-lg border transition hover:opacity-90"
          style={{ backgroundColor: 'var(--accent)', borderColor: 'var(--accent)' }}
        >
          <div className="font-semibold" style={{ color: 'var(--surface)' }}>✍️ {hub.signUp.label}</div>
          <div className="text-sm mt-0.5" style={{ color: 'var(--bg-subtle)' }}>{hub.signUp.hint}</div>
        </Link>
      )}

      {hub.mine.length > 0 && (
        <>
          <TileGrid tiles={hub.mine} />
          <h2
            className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide"
            style={{ color: 'var(--muted)' }}
          >
            About this show
          </h2>
        </>
      )}

      <TileGrid tiles={hub.sections} />

      {!signedIn && (
        <p className="text-sm mt-6 text-center" style={{ color: 'var(--muted)' }}>
          Already have an account?{' '}
          <Link href={`/login?next=${returnTo}`} className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
            Sign in
          </Link>{' '}
          to see your classes and what you owe.
          <br />
          New here?{' '}
          <Link href={`/register?next=${returnTo}`} className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
            Create an account
          </Link>
          .
        </p>
      )}
    </main>
  );
}

/** Two across from `sm` up, one on a phone. */
function TileGrid({ tiles }: { tiles: HubTile[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {tiles.map((tile) => (
        <Link
          key={tile.href}
          href={tile.href}
          className="block p-5 rounded-lg border transition hover:shadow-md hover:bg-amber-50"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <div className="text-3xl mb-2" aria-hidden="true">{tile.icon}</div>
          <div className="font-semibold text-lg" style={{ color: 'var(--foreground)' }}>{tile.title}</div>
          <div className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{tile.description}</div>
        </Link>
      ))}
    </div>
  );
}
