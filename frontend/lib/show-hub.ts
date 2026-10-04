import type { MyShowStanding } from './my-shows';
import { signupDeadlineText } from './registration-window';
import { signUpLink, type SignUpLink } from './show-signup';

/**
 * What a show's main page offers, and to whom — `ShowHub`, rendered at
 * `/shows/[id]` and at `/shows/[id]/live`.
 *
 * **One page for everybody, account or not.** It was three: a signed-out
 * visitor got an event-details card and a row of links, a signed-in exhibitor
 * a menu of tiles that came and went with the show's status, and `/live` — the
 * office's *Public Results* tile and the Active Shows list — a third menu of
 * its own. They described the same show three ways, and a section one of them
 * offered was missing from another. The public results hub already offered
 * every section to everybody, so it is now the page.
 *
 * **The show's sections are the same for every reader, whatever its status**
 * (`publicSections`, then the show office). Each of those pages says for
 * itself when it has nothing yet — "No patterns have been posted", "No points
 * yet" — which tells somebody more than a tile that is missing until the show
 * starts.
 *
 * **What is an exhibitor's own goes on top, never instead**: their status
 * banner, and tiles for what they entered and what they owe (`mine`), above
 * the same sections everybody else sees.
 */

export type HubTile = {
  href: string;
  icon: string;
  title: string;
  description: string;
};

/** The fields of the show payload the menu reads. */
export type HubShow = {
  status: string;
  /** `self_entry.signup_open`: somebody not yet signed up may sign up online
   *  today. Decided on the server; omitted, a published show counts as open. */
  signup_open?: boolean;
  /** The last day to sign up online, `YYYY-MM-DD` (migration 159). */
  entry_deadline?: string | null;
  self_entry_closes?: string | null;
};

/** Who is reading the menu. */
export type HubViewer = {
  signedIn: boolean;
  /** Has an exhibitor record — the permission to enter a show
   *  (`canActAsExhibitor`), not `users.role`. */
  canSelfRegister: boolean;
  /** Their standing at this show (`GET /my-shows/{id}`), or null. */
  standing: MyShowStanding | null;
};

export type ShowHubPlan = {
  /** Where the header's back link goes: the list the show is found on. */
  back: { href: string; label: string };
  /** Whether `ExhibitorStatusBanner` has something of theirs to say. */
  statusBanner: boolean;
  /** The bar across the top of the page: the way in, for somebody who isn't. */
  signUp: SignUpLink | null;
  /** The exhibitor's own tiles, above the show's. Empty for everybody else. */
  mine: HubTile[];
  /** The show's sections and the show office — the same for every reader. */
  sections: HubTile[];
};

/** The show's own sections, in the order the hub has always shown them. */
export function publicSections(showId: string): HubTile[] {
  return [
    {
      href: `/shows/${showId}/schedule`,
      icon: '📋',
      title: 'Class Schedule',
      description: 'Browse the full class list by day and ring.',
    },
    // A pattern is exactly what somebody at the rail with no account opens on
    // their phone, so this is not held back until the office posts one.
    {
      href: `/shows/${showId}/patterns`,
      icon: '📐',
      title: 'Patterns',
      description: 'The pattern each class runs, as the office posts them.',
    },
    {
      href: `/shows/${showId}/results`,
      icon: '🏆',
      title: 'Results',
      description: 'See posted placings as classes finish.',
    },
    {
      href: `/shows/${showId}/leaderboard`,
      icon: '⭐',
      title: 'Leaderboard',
      description: 'High-point standings across the show.',
    },
    {
      href: `/shows/${showId}/showbill`,
      icon: '📄',
      title: 'Show Bill',
      description: 'Classes, judges, fees and rules — print it or save a PDF.',
    },
    {
      href: `/shows/${showId}/details`,
      icon: 'ℹ️',
      title: 'Show Details',
      description: 'Venue, dates, associations, and policies.',
    },
  ];
}

export function buildShowHub(showId: string, show: HubShow, viewer: HubViewer): ShowHubPlan {
  const exhibitor = viewer.signedIn && viewer.canSelfRegister;
  // Somebody with no exhibitor record has no standing anywhere, whatever came back.
  const standing = exhibitor ? viewer.standing : null;
  const signedUp = standing?.signed_up ?? false;
  const entryCount = standing?.entry_count ?? 0;
  const cancelled = Boolean(standing?.cancelled_at);
  // Signed up, or entered by the office without signing up — either way there
  // is an account at this show to read. Somebody with neither has no bill, and
  // a tile promising one would open on "nothing here".
  const hasStanding = signedUp || entryCount > 0;
  // Whether the show sells stalls, shavings or camping. Unknown keeps the
  // wording that mentions them, which is never wrong for long.
  const offersLodging = standing?.offers_lodging !== false;

  const mine: HubTile[] = [];

  // What I entered, then what I owe. The class tile keeps its slot from
  // sign-up to the last day, so it does not move under them mid-show.
  if (signedUp && show.status === 'PUBLISHED') {
    mine.push(
      {
        href: `/shows/${showId}/register/classes`,
        icon: '📝',
        title: 'Add/Drop Classes',
        description: 'Enter or drop classes, and ask for your back number.',
      },
      {
        href: `/shows/${showId}/register`,
        icon: '🗂️',
        title: 'My Registration',
        description: offersLodging
          ? 'Your details, horses, stalls, shavings and camping.'
          : 'Your details and the horses you are bringing.',
      },
    );
  } else if (signedUp && show.status === 'ACTIVE') {
    // Under way: the class doors stay open (`backend/self_entry.py`) unless the
    // office said class changes stop when the show starts. Details and stalls
    // are the office's from here on, so My Registration goes.
    mine.push(
      show.self_entry_closes === 'show_start'
        ? {
            href: `/shows/${showId}/register/classes`,
            icon: '📝',
            title: 'My Classes',
            description: 'What you’re entered in. The show office makes class changes now.',
          }
        : {
            href: `/shows/${showId}/register/classes`,
            icon: '📝',
            title: 'Add/Drop Classes',
            description: 'Enter a class that hasn’t started, or scratch from one that hasn’t finished.',
          },
    );
  }

  // Not gated on registration being open — the bill outlives it, and "you
  // charged me for four stalls" is a question that arrives after the weekend.
  if (hasStanding) {
    mine.push({
      href: `/shows/${showId}/my-bill`,
      icon: '🧾',
      title: 'What I Owe',
      description: offersLodging
        ? 'Class fees, stalls, shavings and the office charge, itemised.'
        : 'Class fees and the office charge, itemised.',
    });
  }

  return {
    // An ACTIVE show is found on Active Shows, which is where the old rail hub
    // went back to; anything else is found from the home page.
    back:
      show.status === 'ACTIVE'
        ? { href: '/shows/active', label: 'Back to Active Shows' }
        : { href: '/', label: 'Back to Shows' },
    statusBanner: exhibitor && (hasStanding || cancelled),
    signUp: wayIn(showId, show, { exhibitor, signedUp, cancelled, entryCount }),
    mine,
    sections: [
      ...publicSections(showId),
      {
        href: `/shows/${showId}/contact`,
        icon: '✉️',
        title: 'Message the Show Office',
        description: 'Ask the secretary a question — no account needed.',
      },
    ],
  };
}

/**
 * The sign-up bar — `signUpLink`, by the show's state, for everybody it
 * doesn't already have an answer for.
 *
 *   * **Everybody who isn't an exhibitor sees the same bar**, signed in or not:
 *     this is the public's page, and the office opens `/live` to check what the
 *     public sees. Signed out, the registration flow sends them through
 *     sign-in, which offers account creation with the same return path. A
 *     signed-in account with no exhibitor record is told there how to set one
 *     up, rather than refused (`/shows/[id]/register`).
 *   * **An exhibitor already in sees none.** Not once signed up; not where
 *     their banner offers its own way back in ("Register again", "Complete
 *     sign-up"), which would put the same destination twice, one above the
 *     other; and not for somebody the office entered once the show is under
 *     way — they are in, and the rest is the office's.
 */
function wayIn(
  showId: string,
  show: HubShow,
  me: { exhibitor: boolean; signedUp: boolean; cancelled: boolean; entryCount: number },
): SignUpLink | null {
  const link = signUpLink(showId, show.status, show.signup_open);
  if (!link) return null;
  const signupOpen = show.status === 'PUBLISHED' && show.signup_open !== false;

  if (me.exhibitor) {
    if (me.signedUp) return null;
    const bannerHasWayIn = signupOpen && (me.cancelled || me.entryCount > 0);
    const enteredAndRunning = show.status === 'ACTIVE' && me.entryCount > 0;
    if (bannerHasWayIn || enteredAndRunning) return null;
  }

  // The registration flow, with the last day to use it where the show gave
  // one. Past that day the hint is already the office's.
  const deadline = signupOpen ? signupDeadlineText(show.entry_deadline) : null;
  return deadline ? { ...link, hint: `${link.hint} ${deadline}` } : link;
}
