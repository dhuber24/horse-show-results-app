/* ───────────────────────────────────────────────────────────────────────────
   Sizing a live board for anything from 24" to 75". Every board on the Live
   Screens page — the Results Board, Results & High Point and the Gate Board —
   is sized by this one question, so a TV set up for one is set up for all.

   Those two ends want opposite layouts, and what separates them is not
   something the browser can measure. Both panels are almost always 1920x1080,
   and a 4K TV usually reports 1920 CSS pixels too. What differs is how far
   away the reader stands — four feet at a desk, thirty across a lobby — and
   the sign-maker's rule is about an inch of letter height per ten feet of it.
   So the same pixel grid needs letters four or five times taller in the hall,
   which means four or five times fewer of them on screen.

   No API reports a diagonal. So each board asks, on the page it opens onto,
   and carries the answer in the URL (`?size=`) — never in the browser's
   storage. A remembered size skipped the pages in front of the board on every
   later visit, and those are where the marquee is set and the gate board's
   ring is chosen, so the Live Screens button has to land on them every time.
   The URL still survives a reload of the TV's browser, and a link with
   `?size=` on it can still be bookmarked for one particular screen.
   Everything else derives from the answer:

     --u    one unit, for what the board is there to show. Expressed in `vh`
            so the layout follows the panel rather than its pixel count — a
            1080p and a 4K screen of the same size lay out identically — times
            the preset's scale.
     --uc   the same unit compressed for chrome. See `chrome` below.

   Every measurement is a multiple of one of those two: type, badges, gutters,
   ticker speed, and how large the rows are drawn. One answer re-proportions
   the whole board together, instead of a dozen font sizes drifting apart.
   ─────────────────────────────────────────────────────────────────────────── */

export const U_VH = 1.7;

export type SizeKey = 'desk' | 'room' | 'hall';

export type Preset = {
  label: string;
  inches: string;
  distance: string;
  blurb: string;
  icon: string;
  /** Multiplier on --u. Tracks viewing distance, not diagonal. */
  scale: number;
  /** --uc is --u times this. The show name, the clock and the ticker are
   *  context a room learns once; the placings are what it is actually
   *  reading from thirty feet. Scaling both together let the furniture eat
   *  two thirds of a lobby screen, so the further off the board is, the more
   *  the chrome gives back to the results. */
  chrome: number;
  /** Reading is slower at distance, so each screen is held longer. */
  dwell: number;
  /** Percentage inset for TV overscan, which still crops a few percent on
   *  plenty of sets. A desk monitor has none, so it gets none. */
  safe: number;
};

export const PRESETS: Record<SizeKey, Preset> = {
  desk: {
    label: 'Desk monitor',
    inches: '24"–32"',
    distance: 'Read from 3–8 ft',
    blurb: 'On a desk, or a wall you can reach. Shows the most.',
    icon: '🖥️',
    scale: 1,
    chrome: 1,
    dwell: 1,
    safe: 0,
  },
  room: {
    label: 'Room TV',
    inches: '40"–55"',
    distance: 'Read from 8–20 ft',
    blurb: 'Ring-side, or on the office wall for the room.',
    icon: '📺',
    scale: 1.4,
    chrome: 0.85,
    dwell: 1.2,
    safe: 1.5,
  },
  hall: {
    label: 'Lobby TV',
    inches: '60"–75"+',
    distance: 'Read from 20–40 ft',
    blurb: 'Across a lobby or an arena. Few rows, very large.',
    icon: '🏟️',
    scale: 1.85,
    chrome: 0.72,
    dwell: 1.45,
    safe: 2.5,
  },
};

export const SIZE_ORDER: SizeKey[] = ['desk', 'room', 'hall'];

export function parseSize(value: string | null): SizeKey | null {
  return value && value in PRESETS ? (value as SizeKey) : null;
}

/** Board sizes: u(2.6) -> calc(var(--u) * 2.6) */
export const u = (n: number) => `calc(var(--u) * ${n})`;
/** Chrome sizes, off the compressed unit. */
export const c = (n: number) => `calc(var(--uc) * ${n})`;

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** `i` wrapped into 0..n-1, negatives included — a board's clock only counts
 *  up (or down, stepping back), and each list takes its own turn off it. */
export const wrap = (i: number, n: number) => ((i % n) + n) % n;
