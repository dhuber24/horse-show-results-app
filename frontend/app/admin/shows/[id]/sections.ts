import type { DeclinableFeature } from '../_wizard/steps';

/**
 * The areas of a show's office: the tiles on the show dashboard, and the
 * show's entries in the staff sidebar (`app/@sidebar/`). One list, so the
 * two cannot drift — a section added to the dashboard and missing from the
 * sidebar would be a screen desktop staff could reach only by going back to the
 * dashboard first.
 */
export type ShowSection = {
  href: string;
  title: string;
  /** The sidebar's shorter name, where the tile's title is a sentence. */
  navLabel?: string;
  description: string;
  icon: string;
  newTab?: boolean;
  /** What the public sees rather than office work. The sidebar sets these
   *  apart at the bottom; on the dashboard they are simply the last tiles. */
  publicScreen?: boolean;
  // Score Classes is disabled unless the show is In Progress, so it renders
  // through ScoringTile rather than as a plain link.
  scoring?: boolean;
  // What setup asks about this (migration 154). Declined there, the tile greys
  // out rather than sitting on the dashboard looking like work nobody has done.
  feature?: DeclinableFeature;
};

// The grid is two across (three on the desktop layout), so this order is the
// layout, and the sidebar's: the tiles worked every
// show (the desk, scoring, money) first, then Patterns and High Point, which
// most shows use, then Side Pots and Futurities, which most shows do not.
export const showSections = (showId: string): ShowSection[] => [
  // Staff and the class schedule were tiles of their own. Both are things you
  // set up once, before the show runs, so both are steps of the setup wizard —
  // staff in Step 1 next to the dates, classes in Step 4.
  {
    href: `/admin/shows/${showId}/setup`,
    title: 'Setup',
    description:
      'Basics and staff, judges, lodging, classes, sanctioning, futurities, side pots, fees and paperwork — the setup wizard.',
    icon: '🎪',
  },
  // Entries, back numbers, and paperwork check-in were three tiles and three
  // screens; they are one conversation at the counter, so they are one tile and
  // one screen. The old routes redirect here.
  {
    href: `/admin/shows/${showId}/desk`,
    title: 'Registration Desk',
    description: 'Back numbers, class entries, side pot buy-ins, and paperwork check-in — one exhibitor at a time.',
    icon: '🎟️',
  },
  {
    href: `/shows/${showId}`,
    title: 'Score Classes',
    description: 'Enter placings for each class.',
    icon: '🏆',
    scoring: true,
  },
  {
    href: `/admin/shows/${showId}/financials`,
    title: 'Financials',
    description: 'Registrations, revenue, outstanding balances, and reports.',
    icon: '💵',
  },
  // Not a setup step: patterns arrive from the judges in the days before the
  // show and change on the day, so this is worked alongside the show rather
  // than set once in the wizard.
  {
    href: `/admin/shows/${showId}/patterns`,
    title: 'Patterns',
    description:
      'The judges’ patterns, on file and ticked against the classes that run them — exhibitors open them from the schedule.',
    icon: '📐',
  },
  // Beside the patterns because both are worked while the show runs. The
  // standings are the public leaderboard; this is where the office says which
  // points system scores them (migration 147).
  {
    href: `/admin/shows/${showId}/high-point`,
    title: 'High Point',
    description:
      'The points chart the public leaderboard scores posted classes by — from an association template or your own — and the season circuits this show counts toward.',
    icon: '⭐',
    feature: 'highpoint',
  },
  {
    href: `/admin/shows/${showId}/side-pots`,
    title: 'Side Pots',
    description: 'Divisional jackpots spanning several classes — buy-ins, standings, and payouts.',
    icon: '💰',
    feature: 'sidepots',
  },
  {
    href: `/admin/shows/${showId}/futurities`,
    title: 'Futurities',
    description:
      'Futurity classes, entry fee categories, entries, and Hi-Point award divisions.',
    icon: '🌟',
    feature: 'futurities',
  },
  // What the office sends the association afterwards. Its own tile rather than
  // a link under Financials: these reports are the record of what happened —
  // placings, entries, judges' cards, compliance — and none of them are money.
  {
    href: `/admin/shows/${showId}/reports`,
    title: 'Show Record',
    description:
      'Results, entry cards, judges’ cards and the compliance sheet — what the office sends on, plus the retention bundle to keep on file.',
    icon: '📁',
  },
  {
    href: `/admin/shows/${showId}/messages`,
    title: 'Messages',
    description: 'Questions sent from the show page, including from people without an account.',
    icon: '✉️',
  },
  // The public screens, reached from the office rather than by finding the
  // show's own page. Not status-gated: what the rail sees is worth checking
  // before the gates open, not only once results are going up. Named for both
  // halves of the hub it lands on, and "Public" so it does not read as the
  // office's own results work; the screens the show *puts up* are the tile below.
  {
    href: `/shows/${showId}/live`,
    title: 'Public Results & Show Details',
    navLabel: 'Public Results',
    description:
      'Schedule, posted placings, leaderboard, and the show bill — what exhibitors and spectators see on their own phones.',
    icon: '📱',
    publicScreen: true,
  },
  // The wall display. Staff-only, and reached only from here — it is not a
  // tile on the public hub, because deciding to put a show up on a screen in
  // the lobby is the office's call rather than a spectator's.
  {
    href: `/admin/shows/${showId}/board`,
    title: 'Live Screens',
    description:
      'Put the results board up on a lobby or ring-side TV, and set the message its marquee scrolls.',
    icon: '📺',
    // Opens in its own tab: this one gets dragged onto the TV and left there,
    // and whoever opened it still needs the console they came from.
    newTab: true,
    publicScreen: true,
  },
];
