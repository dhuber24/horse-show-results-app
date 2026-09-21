'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import Ribbon from '@/components/Ribbon';
import { errorMessage } from '@/lib/api-error';
import type { Marquee, MarqueeMode } from '@/lib/api';

/* ───────────────────────────────────────────────────────────────────────────
   Sizing this for anything from 24" to 75".

   Those two ends want opposite layouts, and what separates them is not
   something the browser can measure. Both panels are almost always 1920x1080,
   and a 4K TV usually reports 1920 CSS pixels too. What differs is how far
   away the reader stands — four feet at a desk, thirty across a lobby — and
   the sign-maker's rule is about an inch of letter height per ten feet of it.
   So the same pixel grid needs letters four or five times taller in the hall,
   which means four or five times fewer of them on screen.

   No API reports a diagonal. So the board asks, on the Results Board page it
   opens onto, and carries the answer in the URL (`?size=`) — never in the
   browser's storage. A remembered size skipped the pages in front of the
   board on every later visit, and those are where the marquee is set and the
   gate board will be chosen, so the Live Screens button has to land on them
   every time. The URL still survives a reload of the TV's browser, and a link
   with `?size=` on it can still be bookmarked for one particular screen.
   Everything else derives from the answer:

     --u    one unit, for the results. Expressed in `vh` so the layout follows
            the panel rather than its pixel count — a 1080p and a 4K screen of
            the same size lay out identically — times the preset's scale.
     --uc   the same unit compressed for chrome. See `chrome` below.

   Every measurement is a multiple of one of those two: type, badges, gutters,
   ticker speed, and how many placings fit on a page. One answer re-proportions
   the whole board together, instead of a dozen font sizes drifting apart.
   ─────────────────────────────────────────────────────────────────────────── */

const U_VH = 1.7;

type SizeKey = 'desk' | 'room' | 'hall';

const PRESETS: Record<
  SizeKey,
  {
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
  }
> = {
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
    blurb: 'Across a lobby or an arena. Few placings, very large.',
    icon: '🏟️',
    scale: 1.85,
    chrome: 0.72,
    dwell: 1.45,
    safe: 2.5,
  },
};

const SIZE_ORDER: SizeKey[] = ['desk', 'room', 'hall'];

function parseSize(value: string | null): SizeKey | null {
  return value && value in PRESETS ? (value as SizeKey) : null;
}

/* Layout constants. ROW_U, JUDGE_HEAD_U and CLASS_HEAD_UC are pinned as
   explicit heights on the elements themselves, so the arithmetic deciding what
   fits is exact rather than a guess at what the type will measure out to. */
const ROW_U = 3.7; // a placing row: ribbon, name, horse, and the gap under it
const RIBBON_U = 2.5; // the rosette's width; its height is 44/32 of that, inside ROW_U
const JUDGE_HEAD_U = 2.4; // "Judge Delgado" and its margin
/* A class's header — context line plus up to two lines of class name — in
   units of **--uc**, not --u. Which class this is, is context a room reads
   once; the placings are what it came for. Same reasoning as `chrome` in
   PRESETS, applied one level down.

   It sits **once, above the class's judge boxes**, not inside each of them. A
   panel-judged class used to repeat ring, division, discipline and name in
   every box on the screen — four copies of the same two lines, when the only
   thing that differed was the judge — and each copy was height taken from the
   placings. */
const CLASS_HEAD_UC = 4.6;
const CLASS_HEAD_GAP_UC = 0.5; // between a class's header and the boxes under it
const PANE_PAD_U = 1.4; // a judge box's own top and bottom padding, together
const GRID_GAP_U = 1.6; // between boxes and between classes, both ways
const TICKER_U_PER_SEC = 4.5; // ticker travel per second, in units, so the
// crawl reads at one speed to the eye at every scale

/* How a screen divides between classes that share it: two rows of two. The
   board carried one class at a time, which answers "what won class 14" and not
   the question people actually walk up with — "has mine gone up yet?" — because
   finding out meant waiting out every other class of the day.

   A class takes as much of that as it has judges: a single-judge class takes a
   quarter, a two-judge class a row, and a panel of three or more the whole
   screen, with its header once across the top. Four quarters at every preset is
   a deliberate choice with a cost — the sign-maker's rule behind PRESETS wants
   fewer, larger items the further away the reader is — so a class that cannot
   fit one whole placing in its share at this size is given the screen instead,
   and deeper cards page. The fit is measured, so a box shows whole rows and
   never a row sliced through the middle. */
const SCREEN_COLS = 2;
const SCREEN_ROWS = 2;
const CELLS_PER_SCREEN = SCREEN_COLS * SCREEN_ROWS;

/* How deep into a card the board goes: places one to four, and no further.
   Everybody on the grounds has the whole card on their phone, so the wall is
   not the record — it is the answer to "has mine gone up, and who won", and a
   room reads four placings at a glance where it has to wait out twelve.

   **Places, not rows.** A tie for fourth shows both horses, because showing
   one of two tied horses is choosing between them, and the board has no
   business doing that. And only placed rows: a disqualification or a no-score
   is on the card on the phone, not in anybody's top four. */
const TOP_PLACES = 4;

function topPlacings(rows: Placing[]): Placing[] {
  return rows.filter((r) => r.place != null && r.place <= TOP_PLACES);
}

/* Roughly two minutes of rotation. A morning with three classes posted can
   afford to page all the way down each one; an evening with thirty cannot, or
   somebody waiting on their class waits a quarter of an hour for it to come
   round again. This is the budget of screens divided between the posted
   classes, counted in quarters of a screen. */
const CYCLE_SLIDES = 14;

/** Results sizes: u(2.6) -> calc(var(--u) * 2.6) */
const u = (n: number) => `calc(var(--u) * ${n})`;
/** Chrome sizes, off the compressed unit. */
const c = (n: number) => `calc(var(--uc) * ${n})`;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

interface ClassItem {
  id: string;
  class_number: string;
  class_name: string;
  class_date: string;
  status: string;
  ring_name?: string | null;
  discipline_name?: string | null;
  division_name?: string | null;
  results_published_at: string | null;
  entry_count?: number;
}

interface Placing {
  place: number | null;
  is_tie: boolean;
  outcome: string;
  outcome_note?: string | null;
  back_number: number | null;
  exhibitor_name: string;
  horse_name: string | null;
  judge_name: string | null;
  /** The surname on its own, off the results-index payload. Not split from
   *  `judge_name` here: "Mary Jo Van Dyke" is not "Dyke", and a board is read
   *  by people who know the judge. */
  judge_last_name?: string | null;
}

interface ShowInfo {
  name: string;
  venue?: string | null;
  status: string;
}

function placeOrdinal(n: number) {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

function rowLabel(p: Placing) {
  const who = [p.exhibitor_name, p.horse_name].filter(Boolean).join(' · ');
  return p.back_number != null ? `#${p.back_number} ${who}` : who;
}

type JudgeGroup = { judge: string | null; rows: Placing[]; total: number };

/** Groups a class's placings by judge. A single-judge class (nearly all of
 *  them) collapses to one group with a null key, so the stage renders one
 *  plain list instead of a pointless "Judge: —" header. */
function groupByJudge(rows: Placing[]): JudgeGroup[] {
  const judges = rows.map((r) => r.judge_name).filter((j): j is string => Boolean(j));
  const distinct = Array.from(new Set(judges));
  if (distinct.length < 2) return [{ judge: null, rows, total: rows.length }];
  return distinct.map((j) => {
    const own = rows.filter((r) => r.judge_name === j);
    return { judge: j, rows: own, total: own.length };
  });
}

/** The surname a show would announce a card under, taken from the column the
 *  backend sends. Null on an unattributed card, which is not an error — a
 *  placing filed against no judge is a real state. */
function judgeSurname(rows: Placing[]): string | null {
  return rows.find((r) => r.judge_last_name)?.judge_last_name ?? null;
}

/* ── Blocks and slides ─────────────────────────────────────────────────────
   A **block** is one class: its header, once, and a box per judge's card
   under it — "the placing by judge", with the class named a single time. A
   **slide** is a screenful: either up to four quarters' worth of blocks in two
   rows, or one block with the screen to itself.

   A box carries a card's top four places (TOP_PLACES), and the header says
   "top 4 of 12" whenever a card holds more, so nobody reads a short list as
   the whole class. Where even four rows are more than a box fits — the room
   and lobby presets — all of a class's cards page together, "1 / 2" in its
   header, so a screen never stands one judge's first page beside another's
   second. And no class owns the rotation: each gets a share of the screens,
   and a card whose pages would outrun its share shows fewer and says so.
   ────────────────────────────────────────────────────────────────────────── */

type Card = {
  /** The judge whose card this is, or null on a single-judge class. */
  judge: string | null;
  surname: string | null;
  rows: Placing[];
};

/** How much of a screen a block takes: a quarter, a row, or all of it. */
type Span = 1 | 2 | 'screen';

type Block = {
  cls: ClassItem;
  cards: Card[];
  span: Span;
  page: number;
  pages: number;
  /** Set when a card holds more than the block shows. */
  shownOf: { shown: number; total: number } | null;
};

type Slide = { kind: 'rows'; rows: Block[][] } | { kind: 'screen'; block: Block };

/** How the boxes of a block with the screen to itself are arranged: up to
 *  three across in one row, four two by two, and beyond that three to a row. */
function screenGrid(judges: number) {
  const cols = judges <= 3 ? Math.max(judges, 1) : judges === 4 ? 2 : 3;
  return { cols, rows: Math.ceil(judges / cols) };
}

/** Whole placings a judge box holds at this size, for each kind of block —
 *  worked out from the measured stage, never from a breakpoint. */
type Fit = {
  /** How the shared screens divide: one row when everything posted fits in one. */
  rowsTemplate: { cols: number; rows: number };
  /** A box in a quarter or a row, without and with a judge's name over it. */
  inRowPlain: number;
  inRowJudged: number;
  /** A box in a block that has the screen to itself, by number of judges. */
  onScreen: (judges: number) => number;
};

function spanFor(judges: number, fit: Fit): Span {
  if (judges >= 3) return 'screen';
  // A class that cannot show one whole placing in its share would have it
  // sliced through the middle, so it gets the screen instead. This is what
  // happens to a two-judge class at the lobby preset.
  const fits = judges === 1 ? fit.inRowPlain : fit.inRowJudged;
  return fits < 1 ? 'screen' : (judges as 1 | 2);
}

function buildBlocks(classes: ClassItem[], groups: JudgeGroup[][], fit: Fit): Block[] {
  const spans = groups.map((g) => spanFor(g.length, fit));
  const cells = spans.reduce<number>((n, s) => n + (s === 'screen' ? CELLS_PER_SCREEN : s), 0);
  const budget = clamp(Math.round((CYCLE_SLIDES * CELLS_PER_SCREEN) / Math.max(cells, 1)), 1, 4);

  // Built per class first, then interleaved below.
  const byClass: Block[][] = classes.map((cls, ci) => {
    const cardsFor = groups[ci];
    const span = spans[ci];
    const named = cardsFor.length > 1;
    const perBox = Math.max(
      1,
      span === 'screen' ? fit.onScreen(cardsFor.length) : named ? fit.inRowJudged : fit.inRowPlain,
    );
    const tops = cardsFor.map((g) => topPlacings(g.rows));
    const deepest = tops.reduce((m, t) => Math.max(m, t.length), 0);
    // Counted against the whole card, not against the top four: "top 4 of 12"
    // is what tells somebody whose horse placed seventh that the rest is on
    // their phone rather than missing.
    const total = cardsFor.reduce((m, g) => Math.max(m, g.rows.length), 0);
    const pages = clamp(Math.ceil(deepest / perBox), 1, budget);
    const shown = Math.min(deepest, pages * perBox);
    // "Top N" names the last *place* shown, not a count of rows: a tie for
    // fourth is five horses and still the top four.
    const lastPlace = tops.reduce((m, t) => Math.max(m, t[Math.min(shown, t.length) - 1]?.place ?? 0), 0);
    const own: Block[] = [];
    for (let p = 0; p < pages; p++) {
      own.push({
        cls,
        span,
        page: p + 1,
        pages,
        cards: cardsFor.map((g, gi) => ({
          judge: g.judge,
          surname: judgeSurname(g.rows),
          rows: tops[gi].slice(p * perBox, (p + 1) * perBox),
        })),
        shownOf: shown > 0 && shown < total ? { shown: lastPlace, total } : null,
      });
    }
    return own;
  });

  // **Every class's first page before any class's second.** Laid out class by
  // class instead, a screen of quarters was two classes shown twice, which is
  // the opposite of the point: somebody walks up to find out whether *their*
  // class is up, and the first screen should carry as many different classes
  // as it holds.
  const blocks: Block[] = [];
  const most = byClass.reduce((m, own) => Math.max(m, own.length), 0);
  for (let p = 0; p < most; p++) {
    for (const own of byClass) {
      if (own[p]) blocks.push(own[p]);
    }
  }
  return blocks;
}

/** Packs blocks into screenfuls, greedily and **in order** — newest-posted
 *  first, the order `postedToday` already put them in. A quarter that fits in
 *  a row already started goes there rather than leaving a hole; a block that
 *  needs the whole screen closes the one being filled first, so the rotation
 *  keeps its order. */
function buildSlides(blocks: Block[], template: { cols: number; rows: number }): Slide[] {
  const slides: Slide[] = [];
  let rows: { blocks: Block[]; used: number }[] = [];
  const close = () => {
    if (rows.length) slides.push({ kind: 'rows', rows: rows.map((r) => r.blocks) });
    rows = [];
  };
  for (const b of blocks) {
    if (b.span === 'screen') {
      close();
      slides.push({ kind: 'screen', block: b });
      continue;
    }
    const need = Math.min(b.span, template.cols);
    let row = rows.find((r) => template.cols - r.used >= need);
    if (!row) {
      if (rows.length >= template.rows) close();
      row = { blocks: [], used: 0 };
      rows.push(row);
    }
    row.blocks.push(b);
    row.used += need;
  }
  close();
  return slides;
}

/** Placings on a screen, which is what its dwell is priced from. */
function slidePlacings(slide: Slide) {
  const blocks = slide.kind === 'screen' ? [slide.block] : slide.rows.flat();
  return blocks.reduce((n, b) => n + b.cards.reduce((m, card) => m + card.rows.length, 0), 0);
}

/** How long a screen is held: longer when it carries more, and longer again
 *  the further away it is being read from.
 *
 *  A screen is up to four classes rather than one, so both the floor and the
 *  ceiling are higher than they were — there is four times as much to get
 *  through, and a board that turns over before anyone has found their class
 *  is one people stop looking at. Priced off every placing on the screen, not
 *  the tallest pane.
 *
 *  Then a flat EXTRA_DWELL_MS on top, after the clamp: the priced figure
 *  turned the screens over before a room had read four classes. Flat rather
 *  than scaled by `dwell`, so it is the same five seconds on every screen at
 *  every preset — and after the clamp, so it lengthens the longest screens
 *  too instead of being swallowed by the ceiling. */
const EXTRA_DWELL_MS = 5000;

function slideMs(rows: number, dwellFactor: number) {
  return Math.round(clamp((6000 + 450 * rows) * dwellFactor, 9000, 34000)) + EXTRA_DWELL_MS;
}

/* The screen times the office can choose instead of `slideMs`: ten-second
   steps up to a minute, then whole minutes up to ten. Seconds are the useful
   grain while a room is reading placings as they go up; past a minute nobody
   is timing it to the second, and a board holding one screen for ten minutes
   is being used as a notice — the top of a class during a long break. */
const EVERY_CHOICES = [10, 20, 30, 40, 50, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600];

function everyLabel(seconds: number) {
  return seconds < 60 ? `${seconds} sec` : `${seconds / 60} min`;
}

/** `?every=` as one of the offered times, or null for Auto. Anything else in
 *  the URL — a typo, an old bookmark — is Auto rather than an error. */
function parseEvery(value: string | null): number | null {
  const n = Number(value);
  return value && EVERY_CHOICES.includes(n) ? n : null;
}

/** Observes an element's content box. A callback ref rather than an object
 *  one, because the stage remounts on every slide and the observer has to
 *  follow it. */
function useBoxSize() {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox((prev) =>
        Math.abs(prev.w - width) < 1 && Math.abs(prev.h - height) < 1 ? prev : { w: width, h: height },
      );
    });
    ro.observe(node);
    observer.current = ro;
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, box] as const;
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

function PlacingRow({ r }: { r: Placing }) {
  return (
    <li className="flex items-center" style={{ gap: u(0.8), height: u(ROW_U) }}>
      {/* The rosette from the class results page, in the colours a horse show
          room already reads a placing by. Its number is drawn larger than the
          results page's, which prints the ordinal underneath — on the board
          the rosette is all there is to go on. Every row here is placed:
          `topPlacings` let nothing else through. */}
      {r.place != null && (
        <Ribbon
          place={r.place}
          numberSize={14}
          style={{
            flex: 'none',
            width: u(RIBBON_U),
            height: u((RIBBON_U * 44) / 32),
          }}
        />
      )}

      {/* Two lines rather than one. The old single line had to truncate, and
          the first thing to go was always the horse — on a results board the
          horse is half of who won. Splitting them also lets the exhibitor be
          set larger than the horse, which is the order a room reads them in. */}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline" style={{ gap: u(0.45) }}>
          {r.back_number != null && (
            <span
              className="flex-none font-semibold tabular-nums"
              style={{
                fontSize: u(1.85),
                lineHeight: 1.05,
                color: 'var(--on-slate-muted)',
              }}
            >
              #{r.back_number}
            </span>
          )}
          <span
            className="truncate font-semibold"
            style={{
              fontSize: u(1.85),
              lineHeight: 1.05,
              color: 'var(--on-slate)',
            }}
          >
            {r.exhibitor_name}
          </span>
          {r.is_tie && (
            <span className="flex-none" style={{ fontSize: u(1.1), color: 'var(--on-slate-muted)' }}>
              (tie)
            </span>
          )}
        </span>
        {r.horse_name && (
          <span
            className="block truncate"
            style={{
              fontSize: u(1.2),
              lineHeight: 1.15,
              color: 'var(--on-slate-muted)',
            }}
          >
            {r.horse_name}
          </span>
        )}
      </span>
    </li>
  );
}

/** One judge's card: the judge's name when there is a panel, and the
 *  placings. Nothing about the class — that is in the header above it, once. */
function JudgeBox({ card, named, page }: { card: Card; named: boolean; page: number }) {
  return (
    <div
      className="flex flex-col min-h-0 min-w-0 overflow-hidden"
      style={{
        backgroundColor: 'var(--slate-raised)',
        borderRadius: u(0.8),
        padding: `${u(0.7)} ${u(1)}`,
      }}
    >
      {named && (
        <div
          className="font-semibold truncate flex-none flex items-center"
          style={{
            fontSize: u(1.15),
            height: u(JUDGE_HEAD_U),
            color: 'var(--accent-light)',
          }}
        >
          {/* The surname, as on the marquee. A quarter-width box is mostly
              ellipsis if it is given "Judge Leigh Ann Skurupey". */}
          Judge {card.surname ?? card.judge}
        </div>
      )}

      {/* `safe center`: a short card sits in the middle of its box rather than
          hanging off the top, and if a resize ever leaves the rows momentarily
          taller than the box the overflow falls off the bottom rather than
          cutting off first place. */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col" style={{ justifyContent: 'safe center' }}>
        {card.rows.length > 0 ? (
          <ul className="min-w-0">
            {card.rows.map((r, i) => (
              <PlacingRow key={i} r={r} />
            ))}
          </ul>
        ) : page === 1 ? (
          <p style={{ fontSize: u(1.2), color: 'var(--on-slate-muted)' }}>No placings recorded.</p>
        ) : null}
      </div>
    </div>
  );
}

/** Which class this is — ring, division, discipline, number and name — said
 *  once for all of its judges. Pinned height, so the arithmetic that decided
 *  how many rows fit below is exact rather than a guess at what two lines of
 *  class name measure out to. */
function ClassHeader({ block }: { block: Block }) {
  const { cls, page, pages, shownOf } = block;
  const context = [cls.ring_name, cls.division_name, cls.discipline_name].filter(Boolean).join(' · ');

  return (
    <header
      className="flex-none min-w-0 flex flex-col justify-center"
      style={{
        height: c(CLASS_HEAD_UC),
        marginBottom: c(CLASS_HEAD_GAP_UC),
        paddingInline: u(0.3),
      }}
    >
      <div
        className="font-medium tracking-wide flex items-center min-w-0"
        style={{
          fontSize: c(0.95),
          color: 'var(--on-slate-muted)',
          gap: c(0.5),
        }}
      >
        <span className="truncate">{context || 'Class results'}</span>
        {pages > 1 && (
          <span
            className="flex-none rounded-full tabular-nums"
            style={{
              fontSize: c(0.8),
              padding: `0 ${c(0.45)}`,
              backgroundColor: 'var(--slate-raised)',
              color: 'var(--on-slate-muted)',
            }}
          >
            {page} / {pages}
          </span>
        )}
        {shownOf && (
          <span className="flex-none whitespace-nowrap" style={{ fontSize: c(0.8) }}>
            top {shownOf.shown} of {shownOf.total}
          </span>
        )}
      </div>

      <h2
        className="font-bold"
        style={{
          fontSize: c(1.5),
          lineHeight: 1.05,
          color: 'var(--on-slate)',
          // Two lines, then ellipsis. The name is the one thing here allowed
          // to wrap: a clipped one leaves the room guessing which class it is
          // looking at.
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        #{cls.class_number} · {cls.class_name}
      </h2>
    </header>
  );
}

function ClassBlock({ block, place }: { block: Block; place?: React.CSSProperties }) {
  const judges = block.cards.length;
  const grid = block.span === 'screen' ? screenGrid(judges) : { cols: judges, rows: 1 };

  return (
    <section className="flex flex-col min-h-0 min-w-0 animate-[board-fade-in_0.4s_ease-out]" style={place}>
      <ClassHeader block={block} />
      <div
        className="flex-1 min-h-0 grid"
        style={{
          gap: u(GRID_GAP_U),
          gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
        }}
      >
        {block.cards.map((card, i) => (
          <JudgeBox key={card.judge ?? i} card={card} named={judges > 1} page={block.page} />
        ))}
      </div>
    </section>
  );
}

function SlideView({ slide, template }: { slide: Slide; template: { cols: number; rows: number } }) {
  if (slide.kind === 'screen') {
    return <ClassBlock block={slide.block} place={{ width: '100%', height: '100%' }} />;
  }
  return (
    <div
      className="w-full h-full grid min-h-0"
      style={{
        gap: u(GRID_GAP_U),
        gridTemplateColumns: `repeat(${template.cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${template.rows}, minmax(0, 1fr))`,
      }}
    >
      {/* Placed explicitly rather than left to auto-flow: the packer may have
          dropped a quarter into a hole in an earlier row. No filler for an
          under-full screen — an empty cell is the honest shape of "that is
          everything posted today". */}
      {slide.rows.flatMap((row, ri) => {
        let col = 0;
        return row.map((b) => {
          const need = Math.min(b.span === 'screen' ? template.cols : b.span, template.cols);
          const place = {
            gridRow: ri + 1,
            gridColumn: `${col + 1} / span ${need}`,
          };
          col += need;
          return <ClassBlock key={`${b.cls.id}:${b.page}`} block={b} place={place} />;
        });
      })}
    </div>
  );
}

type TickerItem = { text: string; kind: 'result' | 'message' };

/* In 'both' mode the message comes round again after this many result lines,
   as well as at the head of the loop. Once a lap would be too rarely: a lap is
   every class posted that day, and an announcement that "Ring 2 is on hold"
   seen once every few minutes has been missed by most of the room. */
const MESSAGE_EVERY = 3;

/** What the marquee carries, from the show office's setting and the day's
 *  results. Reads `effective_mode`, which the backend has already dropped back
 *  to the results if a message mode has nothing to say. */
function marqueeItems(mode: MarqueeMode, message: string | null, results: string[]): TickerItem[] {
  const lines = results.map((text): TickerItem => ({ text, kind: 'result' }));
  if (mode === 'results' || !message) return lines;
  const msg: TickerItem = { text: message, kind: 'message' };
  if (mode === 'message' || lines.length === 0) return [msg];
  const out: TickerItem[] = [];
  lines.forEach((line, i) => {
    if (i % MESSAGE_EVERY === 0) out.push(msg);
    out.push(line);
  });
  return out;
}

function Ticker({ items, ucPx }: { items: TickerItem[]; ucPx: number }) {
  const [bandRef, band] = useBoxSize();
  const copyRef = useRef<HTMLSpanElement>(null);
  const [duration, setDuration] = useState(40);
  const signature = items.map((it) => `${it.kind}:${it.text}`).join('\n');

  useEffect(() => {
    const copy = copyRef.current;
    if (!copy || !ucPx || !band.w) return;
    // Travel priced in units, not pixels, so the crawl covers the same angle
    // per second whatever the board is scaled to. A fixed px/sec reads as a
    // sprint on a desk monitor and a drift across a lobby.
    setDuration(Math.max(15, copy.offsetWidth / Math.max(40, ucPx * TICKER_U_PER_SEC)));
  }, [signature, ucPx, band.w]);

  if (items.length === 0) return null;

  // One pass of the strip, then **a band's width of nothing**. The strip
  // travels exactly one copy's width per lap, so that trailing space is what
  // holds the next pass back until the last of this one has left the screen:
  // a message comes in from the right edge only once it has gone off the
  // left, rather than a second copy chasing it across. Repeating a short
  // message to fill the band was tried first, and a line that never stops
  // reading "Lunch until 1:00 ★ Lunch until 1:00" is read as nothing.
  const copy = (
    <>
      {items.map((it, i) => (
        <span key={i} className="flex-none">
          {i > 0 && (
            <span aria-hidden="true" style={{ paddingInline: c(2.2), color: 'var(--on-slate-muted)' }}>
              ★
            </span>
          )}
          <span
            style={
              it.kind === 'message'
                ? // The office talking, not a result: set apart so a room can
                  // tell an announcement from a placing without reading it.
                  { color: 'var(--accent-light)', fontWeight: 700 }
                : undefined
            }
          >
            {it.text}
          </span>
        </span>
      ))}
      <span aria-hidden="true" className="flex-none" style={{ width: band.w }} />
    </>
  );

  return (
    <div ref={bandRef} className="overflow-hidden w-full" style={{ backgroundColor: 'var(--slate-raised)' }}>
      <div
        className="flex whitespace-nowrap font-medium"
        style={{
          color: 'var(--on-slate)',
          fontSize: c(1.45),
          paddingTop: c(0.55),
          paddingBottom: c(0.55),
          animation: `board-marquee ${duration}s linear infinite`,
          width: 'max-content',
        }}
      >
        <span ref={copyRef} className="flex">
          {copy}
        </span>
        <span className="flex" aria-hidden="true">
          {copy}
        </span>
      </div>
    </div>
  );
}

/** Browser full screen for the board.
 *
 *  The page is already a `fixed inset-0` panel, so this is not about layout —
 *  it is about the browser's own chrome. A board dragged onto a lobby TV sits
 *  under a tab strip and an address bar until somebody presses this, and
 *  whoever set it up is usually not the person standing next to the TV with a
 *  keyboard to find F11 on. */
function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement != null);
    onChange();
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = useCallback(() => {
    // A refused request — an iframe with no `allow`, a gesture the browser did
    // not count, a platform with no full screen at all — rejects rather than
    // throwing, and the board carries on exactly as it was.
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  return { isFullscreen, toggle };
}

const MARQUEE_MODES: { key: MarqueeMode; label: string; hint: string }[] = [
  {
    key: 'results',
    label: 'Results',
    hint: 'The latest placings, a line per class',
  },
  { key: 'message', label: 'Message', hint: 'Your message, and nothing else' },
  { key: 'both', label: 'Both', hint: 'Your message, between the results' },
];

// Matches MAX_MESSAGE_CHARS in backend/routers/show_marquee.py.
const MESSAGE_MAX = 500;

/** One line, the way the backend stores it — so a trailing space or a stray
 *  line break does not count as an unsaved change. */
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Sets what the marquee carries. Saved to the show, not to this browser: the
 *  board picks it up on its next poll wherever it is running, so a message
 *  typed in the office reaches the lobby TV without anybody walking over. */
function MarqueeEditor({ showId, marquee }: { showId: string; marquee: Marquee }) {
  const router = useRouter();
  const [mode, setMode] = useState<MarqueeMode>(marquee.mode);
  const [message, setMessage] = useState(marquee.message ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const text = oneLine(message);
  const dirty = mode !== marquee.mode || text !== (marquee.message ?? '');
  const needsMessage = mode !== 'results' && !text;

  // The page polls every 12 seconds and hands this a fresh `marquee` each
  // time. Adopt it only while nothing here is being edited — somebody else may
  // have changed the message from another machine, but a half-typed one must
  // not be overwritten underneath the person typing it.
  useEffect(() => {
    if (dirty) return;
    setMode(marquee.mode);
    setMessage(marquee.message ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `dirty` is read, not tracked: see above
  }, [marquee.mode, marquee.message]);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/shows/${showId}/marquee`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, message: text || null }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorMessage(body, 'Could not save the marquee.'));
        return;
      }
      setMessage(body?.message ?? '');
      setSaved(true);
      router.refresh();
    } catch {
      setError('Could not reach the server. The marquee has not changed.');
    } finally {
      setSaving(false);
    }
  }

  const saveBlocked = saving
    ? 'Saving…'
    : needsMessage
      ? 'Type the message to scroll, or choose Results'
      : !dirty
        ? 'Nothing has changed'
        : null;

  return (
    <div
      className="rounded-xl flex flex-col"
      style={{
        padding: '2.4vh',
        gap: '1.6vh',
        backgroundColor: 'var(--slate-raised)',
        border: '0.2vh solid var(--on-slate-muted)',
        color: 'var(--on-slate)',
      }}
    >
      <div
        role="radiogroup"
        aria-label="What the marquee scrolls"
        className="grid grid-cols-3"
        style={{ gap: '1vh' }}
      >
        {MARQUEE_MODES.map((m) => {
          const on = mode === m.key;
          return (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => {
                setMode(m.key);
                setSaved(false);
              }}
              className="rounded-lg text-left transition"
              style={{
                padding: '1.1vh 1.4vh',
                backgroundColor: on ? 'var(--accent-light)' : 'var(--slate)',
                color: on ? 'var(--brand-slate)' : 'var(--on-slate)',
              }}
            >
              <div className="font-bold" style={{ fontSize: 'max(14px, 2vh)' }}>
                {m.label}
              </div>
              <div style={{ fontSize: 'max(12px, 1.5vh)', opacity: 0.8 }}>{m.hint}</div>
            </button>
          );
        })}
      </div>

      <label className="flex flex-col" style={{ gap: '0.6vh' }}>
        <span className="flex items-baseline justify-between" style={{ fontSize: 'max(13px, 1.7vh)' }}>
          <span style={{ color: 'var(--on-slate-muted)' }}>
            Message
            {mode === 'results' && text ? ' — kept, but not scrolling while Results is chosen' : ''}
          </span>
          <span className="tabular-nums" style={{ color: 'var(--on-slate-muted)' }}>
            {message.length} / {MESSAGE_MAX}
          </span>
        </span>
        <textarea
          value={message}
          maxLength={MESSAGE_MAX}
          rows={2}
          onChange={(e) => {
            setMessage(e.target.value);
            setSaved(false);
          }}
          placeholder="e.g. Class 22 has moved to Ring 2 · Full results are in the GaitDesk app"
          className="rounded-lg w-full resize-none"
          style={{
            // 16px floor: iOS zooms the page into any field set smaller.
            fontSize: 'max(16px, 2vh)',
            padding: '1vh 1.2vh',
            backgroundColor: 'var(--slate)',
            color: 'var(--on-slate)',
            border: '0.15vh solid var(--on-slate-muted)',
          }}
        />
      </label>

      <div className="flex items-center flex-wrap" style={{ gap: '1.4vh' }}>
        <button
          type="button"
          onClick={save}
          disabled={saveBlocked !== null}
          title={saveBlocked ?? 'Save — a board that is already up picks it up within 12 seconds'}
          className="rounded-lg font-bold transition disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            fontSize: 'max(14px, 1.9vh)',
            padding: '0.9vh 2.4vh',
            backgroundColor: 'var(--accent-light)',
            color: 'var(--brand-slate)',
          }}
        >
          {saving ? 'Saving…' : 'Save marquee'}
        </button>
        {error ? (
          <span role="alert" style={{ fontSize: 'max(13px, 1.7vh)', color: 'var(--warning)' }}>
            {error}
          </span>
        ) : saved ? (
          <span
            style={{
              fontSize: 'max(13px, 1.7vh)',
              color: 'var(--accent-light)',
            }}
          >
            Saved. A board that is already up picks it up within 12 seconds.
          </span>
        ) : null}
      </div>
    </div>
  );
}

function HubHeading({ title, note }: { title: string; note?: string }) {
  return (
    <div style={{ marginBottom: '1.4vh' }}>
      <h2 className="font-bold" style={{ fontSize: 'max(18px, 2.8vh)', color: 'var(--on-slate)' }}>
        {title}
      </h2>
      {note && (
        <p
          style={{
            fontSize: 'max(13px, 1.8vh)',
            color: 'var(--on-slate-muted)',
          }}
        >
          {note}
        </p>
      )}
    </div>
  );
}

/** The Results Board page — reached from Live Screens, and where the board
 *  opens onto when it is not running. How big the panel is, and what the
 *  marquee says.
 *
 *  The size question is worded as where the screen is and how far away the
 *  reader stands, not as a diagonal: nobody setting up a lobby TV knows whether
 *  it is 58" or 65", and the distance is what actually decides the layout.
 *
 *  Same dark panel as the board and sized off `vh` like it, because it is
 *  usually opened on the TV's own browser — but it scrolls, and every size has
 *  a px floor, because the marquee is as likely to be changed from a phone in
 *  the office while a board runs somewhere else. */
function ResultsBoardSetup({
  showId,
  showName,
  marquee,
  onPick,
}: {
  showId: string;
  showName: string;
  marquee: Marquee;
  onPick: (k: SizeKey) => void;
}) {
  const card = {
    padding: '2.4vh',
    backgroundColor: 'var(--slate-raised)',
    border: '0.2vh solid var(--on-slate-muted)',
    color: 'var(--on-slate)',
  } as const;

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="mx-auto flex flex-col" style={{ maxWidth: '150vh', padding: '4vh 16px', gap: '3.6vh' }}>
        <header className="flex items-end justify-between flex-wrap" style={{ gap: '1.4vh' }}>
          <div className="min-w-0">
            <h1 className="font-bold" style={{ fontSize: 'max(24px, 4.2vh)', color: 'var(--on-slate)' }}>
              Results Board
            </h1>
            <p className="truncate" style={{ fontSize: 'max(14px, 2vh)', color: 'var(--on-slate-muted)' }}>
              {showName}
            </p>
          </div>
          <Link
            href={`/admin/shows/${showId}/board`}
            className="hover:underline"
            style={{ fontSize: 'max(14px, 1.9vh)', color: 'var(--accent-light)' }}
          >
            ← Live Screens
          </Link>
        </header>

        <section>
          <HubHeading
            title="Where is this screen?"
            note="A browser is never told how big its screen is, and a lobby TV needs letters several times taller than a desk monitor. Pick one and the board starts."
          />
          <div className="grid grid-cols-1 sm:grid-cols-3" style={{ gap: '2vh' }}>
            {SIZE_ORDER.map((key, i) => {
              const p = PRESETS[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onPick(key)}
                  className="rounded-xl text-left transition hover:brightness-125"
                  style={card}
                >
                  <div style={{ fontSize: 'max(28px, 4.4vh)' }} aria-hidden>
                    {p.icon}
                  </div>
                  <div className="font-bold" style={{ fontSize: 'max(18px, 2.6vh)', marginTop: '0.8vh' }}>
                    {p.label}
                  </div>
                  <div style={{ fontSize: 'max(14px, 2vh)', color: 'var(--accent-light)' }}>{p.inches}</div>
                  <div style={{ fontSize: 'max(13px, 1.8vh)', marginTop: '0.6vh', color: 'var(--on-slate-muted)' }}>
                    {p.distance}
                  </div>
                  <div style={{ fontSize: 'max(13px, 1.7vh)', marginTop: '1.1vh', color: 'var(--on-slate-muted)' }}>
                    {p.blurb}
                  </div>
                  <div style={{ fontSize: 'max(12px, 1.5vh)', marginTop: '1.1vh', color: 'var(--on-slate-muted)' }}>
                    Press {i + 1}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <HubHeading title="Marquee" note="What scrolls along the bottom of the board." />
          <MarqueeEditor showId={showId} marquee={marquee} />
        </section>
      </div>
    </div>
  );
}

/* ── The board ──────────────────────────────────────────────────────────── */

export default function LiveBoard({
  showId,
  show,
  classes,
  resultsIndex,
  marquee,
}: {
  showId: string;
  show: ShowInfo;
  classes: ClassItem[];
  resultsIndex: Record<string, Placing[]>;
  marquee: Marquee;
}) {
  const [now, setNow] = useState(() => new Date());
  const [slideIndex, setSlideIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  // The size is the URL's `?size=` and nothing else — no size, and this is the
  // Results Board page. See the note at the top of the file for why it is never
  // kept in the browser's storage. The screen time rides beside it as
  // `?every=`, for the same reasons: it belongs to this screen, it has to
  // survive the TV's browser reloading, and it must not follow the office to
  // the next show.
  const searchParams = useSearchParams();
  const size = parseSize(searchParams.get('size'));
  const every = parseEvery(searchParams.get('every'));

  // Nothing renders until mounted: the board is laid out from the window's
  // height and shows a clock, and neither exists on the server. Rendering
  // them there would be a wrong-scale frame and a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [vh, setVh] = useState(0);
  const [gridRef, gridBox] = useBoxSize();

  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();

  // Controls and cursor surface on movement and go away again, so the board
  // spends its life as a board rather than a web page with buttons on it.
  const [chrome, setChrome] = useState(false);
  const chromeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Held open while the screen-time menu has focus: the browser draws that
  // menu itself, so moving the mouse over it reaches no handler here, and the
  // controls would fade out from under a choice being made.
  const chromePinned = useRef(false);
  const wake = useCallback(() => {
    setChrome(true);
    if (chromeTimer.current) clearTimeout(chromeTimer.current);
    chromeTimer.current = setTimeout(() => {
      if (!chromePinned.current) setChrome(false);
    }, 3000);
  }, []);

  // Written with the History API, which Next folds into its router, so
  // `useSearchParams` follows it with no server round trip. Only the keys
  // named change; the rest of the query stays, so the screen time survives a
  // trip to the Results Board page and back.
  const setQuery = useCallback((changes: Record<string, string | null>, how: 'push' | 'replace') => {
    const q = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(changes)) {
      if (value == null) q.delete(key);
      else q.set(key, value);
    }
    const qs = q.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    if (how === 'push') window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
  }, []);

  // From the Results Board page, starting the board is a new history entry, so
  // Back returns to the page. Changing size on a running board replaces the
  // entry instead, so Back does not step through every size somebody tried.
  const choose = useCallback(
    (k: SizeKey, how: 'push' | 'replace') => setQuery({ size: k }, how),
    [setQuery],
  );

  const toSettings = useCallback(() => setQuery({ size: null }, 'push'), [setQuery]);

  const chooseEvery = useCallback(
    (seconds: number | null) => setQuery({ every: seconds == null ? null : String(seconds) }, 'replace'),
    [setQuery],
  );

  useEffect(() => {
    // Lobby TV, not a page the viewer scrolls — the board owns the whole
    // viewport for as long as it's mounted.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const read = () => setVh(window.innerHeight);
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);

  const preset = size ? PRESETS[size] : PRESETS.room;
  const uPx = (preset.scale * U_VH * vh) / 100;
  const ucPx = uPx * preset.chrome;

  const postedToday = useMemo(() => {
    const posted = classes.filter((c) => c.results_published_at && c.status !== 'DRAFT');
    if (posted.length === 0) return [];
    const latestDate = posted.reduce((max, c) => (c.class_date > max ? c.class_date : max), posted[0].class_date);
    return posted
      .filter((c) => c.class_date === latestDate)
      .sort((a, b) => (b.results_published_at! > a.results_published_at! ? 1 : -1));
  }, [classes]);

  // A class's placings split by judge, computed once: how much of a screen
  // each class takes is decided by how many cards it has, and the blocks are
  // built from the same list.
  const groups = useMemo(
    () => postedToday.map((cls) => groupByJudge(resultsIndex[cls.id] ?? [])),
    [postedToday, resultsIndex],
  );

  // What fits in a judge box, for every kind of block, taken from the stage
  // the browser actually handed us rather than from a breakpoint or a guess at
  // type metrics. The same arithmetic covers every panel in the range, the 4K
  // ones and the odd 21:9 included.
  //
  // Several things come off a box before the placings do, and they are not all
  // in the same unit: its padding and the judge's name scale with the results,
  // the class header over it with the chrome. Leaving the padding out was half
  // a row of overcount, and half a row is exactly what gets sliced through the
  // middle at the bottom.
  const fit = useMemo<Fit>(() => {
    if (!uPx || !gridBox.h) {
      return {
        rowsTemplate: { cols: SCREEN_COLS, rows: SCREEN_ROWS },
        inRowPlain: 3,
        inRowJudged: 3,
        onScreen: () => 3,
      };
    }
    const H = gridBox.h;
    const rowPx = ROW_U * uPx;
    const gapPx = GRID_GAP_U * uPx;
    const headPx = (CLASS_HEAD_UC + CLASS_HEAD_GAP_UC) * ucPx;
    // Unclamped, so a result under one says "not even one row" rather than
    // being rounded up into a row that is then clipped.
    const inBox = (boxH: number, named: boolean) =>
      Math.floor((boxH - PANE_PAD_U * uPx - (named ? JUDGE_HEAD_U * uPx : 0)) / rowPx);
    // A box in a shared screen: its row's share of the height, less the class
    // header above it. The gaps between rows come out before dividing.
    const inRow = (rows: number, named: boolean) => inBox((H - gapPx * (rows - 1)) / rows - headPx, named);
    const onScreen = (judges: number) => {
      const g = screenGrid(judges);
      return inBox((H - headPx - gapPx * (g.rows - 1)) / g.rows, judges > 1);
    };

    // Decided at two rows first, which is what says which classes share a
    // screen at all. If everything that shares fits in one row, that row gets
    // the full height — which only makes boxes taller, so the decision holds.
    const twoRows: Fit = {
      rowsTemplate: { cols: SCREEN_COLS, rows: SCREEN_ROWS },
      inRowPlain: inRow(SCREEN_ROWS, false),
      inRowJudged: inRow(SCREEN_ROWS, true),
      onScreen,
    };
    const sharedCells = groups.reduce((n, g) => {
      const span = spanFor(g.length, twoRows);
      return span === 'screen' ? n : n + span;
    }, 0);
    if (sharedCells > SCREEN_COLS) return twoRows;
    return {
      // A day with one single-judge class posted gets the whole width, as the
      // one-class board always did.
      rowsTemplate: { cols: sharedCells <= 1 ? 1 : SCREEN_COLS, rows: 1 },
      inRowPlain: inRow(1, false),
      inRowJudged: inRow(1, true),
      onScreen,
    };
  }, [uPx, ucPx, gridBox.h, groups]);

  // Fixed for the whole rotation, for a given set of results and a given
  // screen: a layout that reshaped itself between screens would move a class
  // somebody was halfway through reading.
  const slides = useMemo(
    () => buildSlides(buildBlocks(postedToday, groups, fit), fit.rowsTemplate),
    [postedToday, groups, fit],
  );

  const active = slides.length ? slides[slideIndex % slides.length] : null;
  // A screen time the office chose is taken exactly, with no pricing and no
  // preset factor on top: somebody who picked "30 sec" is timing it.
  const dwellMs = !active ? 0 : every != null ? every * 1000 : slideMs(slidePlacings(active), preset.dwell);

  useEffect(() => {
    if (paused || slides.length < 2) return;
    const t = setTimeout(() => setSlideIndex((i) => (i + 1) % slides.length), dwellMs);
    return () => clearTimeout(t);
    // Keyed on the numbers rather than on the slide object: a poll that changes
    // nothing rebuilds `slides` but leaves these equal, so the rotation carries
    // on from where it was instead of snapping back to the first class.
  }, [slideIndex, slides.length, dwellMs, paused]);

  const step = useCallback(
    (delta: number) => {
      setPaused(true); // stepping by hand means you want to look at it
      setSlideIndex((i) => {
        const n = Math.max(slides.length, 1);
        return (i + delta + n) % n;
      });
    },
    [slides.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Typing a marquee message on the Results Board page is typing, not
      // commands: a "1" in the message must not open the board. Nor is a
      // browser shortcut — Ctrl+F is find, not full screen.
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      wake();
      if (e.key >= '1' && e.key <= '3') {
        choose(SIZE_ORDER[Number(e.key) - 1], size ? 'replace' : 'push');
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      } else if (!size) {
        // The rest drive a running board. On the Results Board page, space and
        // the arrows belong to the page — pressing a focused button, scrolling.
        return;
      } else if (e.key === ' ') {
        e.preventDefault();
        setPaused((p) => !p);
      } else if (e.key === 'ArrowRight') {
        step(1);
      } else if (e.key === 'ArrowLeft') {
        step(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choose, step, wake, toggleFullscreen, size]);

  const resultLines = useMemo(() => {
    const items: string[] = [];
    postedToday.forEach((cls, ci) => {
      const head = `#${cls.class_number} ${cls.class_name}`;
      const cardsFor = groups[ci] ?? [];
      if (cardsFor.length === 0) {
        items.push(`${head}: no placings yet`);
        return;
      }
      // One line per judge's card, never a merged one. The app does not
      // combine cards into an official result, and a marquee crawling past a
      // room is the last place to start.
      for (const g of cardsFor) {
        // The same top four the panes carry, so the marquee and the grid
        // never disagree about how deep the board goes.
        const placed = topPlacings(g.rows);
        const summary = placed.map((r) => `${placeOrdinal(r.place!)} ${rowLabel(r)}`).join('  ·  ');
        const surname = judgeSurname(g.rows);
        items.push(`${head}${surname ? ` · Judge ${surname}` : ''}: ${summary || 'no placings yet'}`);
      }
    });
    return items;
  }, [postedToday, groups]);

  const tickerItems = useMemo(
    () => marqueeItems(marquee.effective_mode, marquee.message, resultLines),
    [marquee.effective_mode, marquee.message, resultLines],
  );

  const btn = {
    fontSize: c(0.85),
    padding: `${c(0.25)} ${c(0.6)}`,
    color: 'var(--on-slate-muted)',
  } as const;

  return (
    <div
      className="fixed inset-0 z-50"
      // The cursor hides only over a running board. The Results Board page is a
      // page somebody is using, with a text box on it.
      style={{
        backgroundColor: 'var(--slate)',
        cursor: size && !chrome ? 'none' : 'auto',
      }}
      onMouseMove={wake}
    >
      {!mounted ? null : size === null ? (
        <ResultsBoardSetup
          showId={showId}
          showName={show.name}
          marquee={marquee}
          onPick={(k) => choose(k, 'push')}
        />
      ) : (
        <div
          className="absolute inset-0 flex flex-col"
          style={
            {
              '--u': `${(preset.scale * U_VH).toFixed(3)}vh`,
              '--uc': `${(preset.scale * preset.chrome * U_VH).toFixed(3)}vh`,
              padding: `${preset.safe}%`,
              // A board runs ten hours a day on a panel that may well be OLED.
              // A slow wander of a few pixels keeps the static furniture — the
              // show name, the ticker rule — off one fixed set of them.
              animation: 'board-drift 1200s ease-in-out infinite',
            } as React.CSSProperties
          }
        >
          <header
            className="flex items-center justify-between flex-none"
            style={{
              paddingInline: c(1.8),
              paddingTop: c(0.6),
              paddingBottom: c(0.7),
            }}
          >
            {/* The way back out of a full-screen board with no chrome. It goes
                to the show's admin console rather than the public hub, because
                the only person who can be looking at this is the one who put
                it up.

                The mark plus the separate 4:1 wordmark, which is the pairing
                the navbar uses and for the same reason: the full lockup's
                minimum is 180px wide, and this header's whole job is to stay
                out of the way of the results. Sized by **width** off the
                chrome unit, so it gives space back to the placings at the
                lobby scale like everything else here — with a px floor under
                each, because the brand minimums (48px mark, 120px wordmark)
                are the point below which the mane strokes and the tagline
                close up, and a unit that scales does not know about them. */}
            <Link
              href={`/admin/shows/${showId}`}
              className="opacity-60 hover:opacity-100 transition flex-none flex items-center"
              style={{ gap: c(0.5) }}
              aria-label="GaitDesk — back to this show's console"
            >
              <Image
                src="/brand/gaitdesk-mark-on-dark-256w.png"
                alt=""
                aria-hidden="true"
                width={256}
                height={360}
                priority
                style={{ width: `max(48px, ${c(2.4)})`, height: 'auto' }}
              />
              <Image
                src="/brand/gaitdesk-wordmark-on-dark-400w.png"
                alt="GaitDesk"
                width={400}
                height={100}
                priority
                style={{ width: `max(120px, ${c(6)})`, height: 'auto' }}
              />
            </Link>

            <div className="text-center min-w-0" style={{ paddingInline: c(1) }}>
              <div className="font-bold truncate" style={{ fontSize: c(1.9), color: 'var(--on-slate)' }}>
                {show.name}
              </div>
              {show.venue && (
                <div className="truncate" style={{ fontSize: c(1.05), color: 'var(--on-slate-muted)' }}>
                  {show.venue}
                </div>
              )}
            </div>

            <div className="flex items-center flex-none" style={{ gap: c(0.5) }}>
              {paused ? (
                <span className="font-semibold tracking-wider" style={{ fontSize: c(1.1), color: 'var(--warning)' }}>
                  ❙❙ PAUSED
                </span>
              ) : (
                <>
                  <span className="relative flex" style={{ width: c(0.55), height: c(0.55) }}>
                    <span
                      className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                      style={{ backgroundColor: 'var(--accent-light)' }}
                    />
                    <span
                      className="relative inline-flex rounded-full h-full w-full"
                      style={{ backgroundColor: 'var(--accent-light)' }}
                    />
                  </span>
                  <span
                    className="font-semibold tracking-wider"
                    style={{ fontSize: c(1.1), color: 'var(--accent-light)' }}
                  >
                    LIVE
                  </span>
                </>
              )}
              <span
                className="tabular-nums"
                style={{
                  fontSize: c(1.25),
                  marginLeft: c(0.4),
                  color: 'var(--on-slate-muted)',
                }}
              >
                {now.toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
            </div>
          </header>

          {/* How long this screen has left. On a board read across a room the
              useful thing is knowing a change is coming, rather than looking up
              to find it already happened. Drawn on a track so a part-filled bar
              reads as progress and not as a stray rule. */}
          <div
            className="flex-none rounded-full overflow-hidden"
            style={{
              height: c(0.16),
              marginInline: c(1.8),
              backgroundColor: 'var(--slate-raised)',
              opacity: active && !paused && slides.length > 1 ? 1 : 0,
            }}
          >
            {active && !paused && slides.length > 1 && (
              <div
                // Keyed on the time as well as the screen: changing the screen
                // time restarts the countdown, and the bar has to restart with
                // it rather than carry on at the old speed.
                key={`${slideIndex}:${dwellMs}`}
                className="h-full"
                style={{
                  backgroundColor: 'var(--accent-light)',
                  opacity: 0.7,
                  transformOrigin: 'left',
                  animation: `board-progress ${dwellMs}ms linear forwards`,
                }}
              />
            )}
          </div>

          <main
            className="flex-1 min-h-0 flex items-center justify-center"
            style={{
              paddingInline: c(1.8),
              paddingTop: c(0.5),
              paddingBottom: c(0.5),
            }}
          >
            {/* The stage measures itself, whatever is on it, and that is what
                decides how many placings the next build puts in a box.
                Estimating it from font sizes was off by most of a row, and the
                row it was off by fell behind the ticker. */}
            <div ref={gridRef} className="w-full h-full min-h-0 flex items-center justify-center">
              {active ? (
                <SlideView key={slideIndex} slide={active} template={fit.rowsTemplate} />
              ) : (
                <div className="flex flex-col items-center justify-center text-center">
                  <div className="font-semibold" style={{ fontSize: u(3), color: 'var(--on-slate)' }}>
                    Waiting on results
                  </div>
                  <p
                    style={{
                      fontSize: u(1.6),
                      marginTop: u(0.8),
                      maxWidth: u(34),
                      color: 'var(--on-slate-muted)',
                    }}
                  >
                    Posted placings will start rotating through here as soon as the first class of the day
                    goes up.
                  </p>
                </div>
              )}
            </div>
          </main>

          <footer className="flex-none">
            <Ticker items={tickerItems} ucPx={ucPx} />
          </footer>

          {/* Setup controls. There for whoever is standing at the screen with a
              mouse, invisible the rest of the time. */}
          <div
            className="absolute flex items-center transition-opacity duration-300"
            style={{
              bottom: c(3.6),
              right: c(1.8),
              gap: c(0.3),
              padding: c(0.35),
              borderRadius: c(0.6),
              backgroundColor: 'var(--slate-raised)',
              opacity: chrome ? 0.95 : 0,
              pointerEvents: chrome ? 'auto' : 'none',
            }}
          >
            {/* Back to the Results Board page, where the board was started from
                — the screen sizes and the marquee message. The logo goes
                further, to the show's console; this is the one to press to
                change what is scrolling. */}
            <button
              type="button"
              onClick={toSettings}
              title="Results Board page — screen size and the marquee message"
              className="rounded whitespace-nowrap"
              style={btn}
            >
              ‹ Settings
            </button>
            <span
              style={{
                width: c(0.06),
                height: c(1.2),
                backgroundColor: 'var(--on-slate-muted)',
                opacity: 0.4,
              }}
            />
            {SIZE_ORDER.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => choose(k, 'replace')}
                title={`${PRESETS[k].label} · ${PRESETS[k].inches} · ${PRESETS[k].distance}`}
                className="rounded transition"
                style={{
                  ...btn,
                  backgroundColor: k === size ? 'var(--accent-light)' : 'transparent',
                  color: k === size ? 'var(--brand-slate)' : 'var(--on-slate-muted)',
                }}
              >
                {PRESETS[k].inches}
              </button>
            ))}
            <span
              style={{ width: c(0.06), height: c(1.2), backgroundColor: 'var(--on-slate-muted)', opacity: 0.4 }}
            />
            {/* Here rather than in the header, because it belongs with the
                other things you press once while standing at the screen and
                never again. */}
            <button
              type="button"
              onClick={toggleFullscreen}
              title={
                isFullscreen
                  ? 'Leave full screen (F)'
                  : 'Fill the screen — hides the tab strip and address bar (F)'
              }
              className="rounded whitespace-nowrap"
              style={btn}
            >
              {isFullscreen ? '⤡ Exit full screen' : '⤢ Full screen'}
            </button>
            <span
              style={{ width: c(0.06), height: c(1.2), backgroundColor: 'var(--on-slate-muted)', opacity: 0.4 }}
            />
            {/* With the other controls of the rotation, beside pause and step.
                A menu rather than a stepper, because the useful jump is from
                "a few seconds" to "a few minutes" and a stepper would make that
                a dozen presses. */}
            <label
              className="flex items-center whitespace-nowrap"
              style={{ ...btn, gap: c(0.35) }}
              title="How long each screen stays up before the board moves on. Auto holds a screen longer when it carries more placings, and longer again at the room and lobby sizes."
            >
              Screen time
              <select
                value={every ?? ''}
                onChange={(e) => {
                  chooseEvery(e.target.value ? Number(e.target.value) : null);
                  // Hand the keyboard back to the board: a focused menu would
                  // take the arrow keys and space that step and pause it.
                  e.currentTarget.blur();
                }}
                onFocus={() => {
                  chromePinned.current = true;
                  wake();
                }}
                onBlur={() => {
                  chromePinned.current = false;
                  wake();
                }}
                className="rounded"
                style={{
                  fontSize: c(0.85),
                  padding: `0 ${c(0.2)}`,
                  backgroundColor: 'var(--slate)',
                  color: 'var(--on-slate)',
                  border: 'none',
                  // The menu the browser opens follows this, so it is dark on
                  // a dark board rather than a white sheet over a lobby TV.
                  colorScheme: 'dark',
                }}
              >
                <option value="">Auto</option>
                {EVERY_CHOICES.map((s) => (
                  <option key={s} value={s}>
                    {everyLabel(s)}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => step(-1)} className="rounded" style={btn}>
              ‹
            </button>
            <button type="button" onClick={() => setPaused((p) => !p)} className="rounded" style={btn}>
              {paused ? '▶' : '❙❙'}
            </button>
            <button type="button" onClick={() => step(1)} className="rounded" style={btn}>
              ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
