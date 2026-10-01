'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import QrCode from '@/components/QrCode';
import Ribbon from '@/components/Ribbon';
import { errorMessage } from '@/lib/api-error';
import type { Marquee, MarqueeMode } from '@/lib/api';
import { formatPoints, topStandings, type ShowLeaderboard, type StandingLine } from '@/lib/high-point';

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
   ticker speed, and how large the placings are drawn. One answer re-proportions
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
const ROW_U = 3.9; // a placing row: ribbon, name, horse, and the gap under it
const RIBBON_U = 2.75; // the rosette's width; its height is 44/32 of that, inside ROW_U
/* The back number, a step below the text beside it: on the name's line
   (a wide card) and on the horse's line (a narrow one, see COMPACT_CARD_U). */
const BACK_NUMBER_U = 1.55;
const BACK_NUMBER_COMPACT_U = 1.0;
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

/* **One class to a screen**, every judge's card of it together on that screen.
   Four classes shared a screen for a while, in quarters, and the show office
   asked for one: a panel-judged class is four cards already, and a room reads
   one class's placings across its judges more easily than four classes' at a
   glance. The header names the class once, above its cards.

   The cards sit **side by side in one row** up to four judges — the full
   height of the screen for each, which is what lets all five places fit at
   the desk and room sizes (a 2 x 2 grid halves that height and fits two to
   four). Past four, three to a row.

   **A class never pages.** Its top five are on the one screen, always — where
   the preset's letters are too big for all of them (a four-judge class at the
   lobby size), that class's cards are drawn smaller until they fit
   (`scaleFor`), rather than turning to a "2 / 2" screen nobody waits for. */
function screenGrid(judges: number) {
  const cols = judges <= 4 ? Math.max(judges, 1) : 3;
  return { cols, rows: Math.ceil(Math.max(judges, 1) / cols) };
}

/* How deep into a card the board goes: places one to five, and no further —
   sixth place never makes the board. Everybody on the grounds has the whole
   card on their phone (the QR code in the header), so the wall is not the
   record — it is the answer to "has mine gone up, and who won", and a room
   reads five placings at a glance where it has to wait out twelve.

   **Places, not rows.** A tie for fifth shows both horses, because showing
   one of two tied horses is choosing between them, and the board has no
   business doing that. And only placed rows: a disqualification or a no-score
   is on the card on the phone, not in anybody's top five. */
const TOP_PLACES = 5;

function topPlacings(rows: Placing[]): Placing[] {
  return rows.filter((r) => r.place != null && r.place <= TOP_PLACES);
}

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

/* ── Screens ────────────────────────────────────────────────────────────────
   A **block** is one screenful, and one class: its header, once, and a box
   per judge's card under it — "the placing by judge", with the class named a
   single time.

   A box carries a card's top five places (TOP_PLACES), all of them, and the
   header carries a **Top 5** badge on every screen, so nobody reads a short
   list as the whole class — or a sixth place as a placing gone missing.
   ────────────────────────────────────────────────────────────────────────── */

type Card = {
  /** The judge whose card this is, or null on a single-judge class. */
  judge: string | null;
  surname: string | null;
  rows: Placing[];
};

type Block = {
  cls: ClassItem;
  cards: Card[];
  /** Which of the class's cards these are, when the split board shows a panel
   *  two at a time (`buildSplitBlocks`). Absent: every card of the class. */
  part?: { from: number; to: number; of: number };
};

/** One block per class, newest-posted first — the order `postedToday`
 *  already put them in. */
function buildBlocks(classes: ClassItem[], groups: JudgeGroup[][]): Block[] {
  return classes.map((cls, ci) => ({
    cls,
    cards: groups[ci].map((g) => ({
      judge: g.judge,
      surname: judgeSurname(g.rows),
      rows: topPlacings(g.rows),
    })),
  }));
}

/** Placings on a screen, which is what its dwell is priced from. */
function blockPlacings(block: Block) {
  return block.cards.reduce((n, card) => n + card.rows.length, 0);
}

/** Rows on the deepest card of a block — what its boxes have to hold. */
function blockDepth(block: Block) {
  return block.cards.reduce((m, card) => Math.max(m, card.rows.length), 0);
}

/** How long a screen is held: longer when it carries more, and longer again
 *  the further away it is being read from.
 *
 *  A screen is one class across every judge — twenty placings on a four-judge
 *  panel — so the floor and the ceiling are generous: a board that turns over
 *  before anyone has found their horse is one people stop looking at. Priced
 *  off every placing on the screen, not the tallest pane.
 *
 *  Then a flat EXTRA_DWELL_MS on top, after the clamp: the priced figure
 *  turned the screens over before a room had read them. Flat rather
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

/** How narrow a judge's card is, in --u, before the back number moves down
 *  onto the horse's line. Four cards across at the room and lobby sizes left
 *  the exhibitor about five letters beside "#263" — "#263 Me…" — and the
 *  name is the part a room cannot work out from anything else on the line. */
const COMPACT_CARD_U = 26;

function PlacingRow({ r, compact }: { r: Placing; compact: boolean }) {
  const back = r.back_number != null ? `#${r.back_number}` : null;
  const backBelow = compact && back;
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
          {back && !compact && (
            <span
              className="flex-none font-semibold tabular-nums"
              style={{
                fontSize: u(BACK_NUMBER_U),
                lineHeight: 1.05,
                color: 'var(--on-slate-muted)',
              }}
            >
              {back}
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
        {(backBelow || r.horse_name) && (
          <span
            className="block truncate"
            style={{
              fontSize: u(1.2),
              lineHeight: 1.15,
              color: 'var(--on-slate-muted)',
            }}
          >
            {backBelow && (
              <span className="tabular-nums" style={{ fontSize: u(BACK_NUMBER_COMPACT_U) }}>
                {back}
                {r.horse_name ? ' · ' : ''}
              </span>
            )}
            {r.horse_name}
          </span>
        )}
      </span>
    </li>
  );
}

/** A box on the stage — a judge's card, or a division's standings. */
const PANE_STYLE = {
  backgroundColor: 'var(--slate-raised)',
  borderRadius: u(0.8),
  padding: `${u(0.7)} ${u(1)}`,
} as const;

/** One judge's card: the judge's name when there is a panel, and the
 *  placings. Nothing about the class — that is in the header above it, once. */
function JudgeBox({ card, named, compact }: { card: Card; named: boolean; compact: boolean }) {
  return (
    <div className="flex flex-col min-h-0 min-w-0 overflow-hidden" style={PANE_STYLE}>
      {named && (
        <div
          className="font-semibold truncate flex-none flex items-center"
          style={{
            fontSize: u(1.15),
            height: u(JUDGE_HEAD_U),
            color: 'var(--accent-light)',
          }}
        >
          {/* The surname, as on the marquee. A quarter-width card is mostly
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
              <PlacingRow key={i} r={r} compact={compact} />
            ))}
          </ul>
        ) : (
          <p style={{ fontSize: u(1.2), color: 'var(--on-slate-muted)' }}>No placings recorded.</p>
        )}
      </div>
    </div>
  );
}

/** Which class this is — ring, division, discipline, number and name — said
 *  once for all of its judges, with the **Top 5** badge just after the name.
 *  Pinned height, so the arithmetic that decided how many rows fit below is
 *  exact rather than a guess at what two lines of class name measure out to. */
function ClassHeader({ block, split = false }: { block: Block; split?: boolean }) {
  const { cls, part } = block;
  // On the split board a panel of more than two takes turns, and this says
  // which turn it is, so nobody takes half a panel for the whole of it.
  const turn = part
    ? part.to > part.from
      ? `Judges ${part.from}–${part.to} of ${part.of}`
      : `Judge ${part.from} of ${part.of}`
    : null;
  const context = [cls.ring_name, cls.division_name, cls.discipline_name, turn].filter(Boolean).join(' · ');
  const placed = block.cards.some((card) => card.rows.length > 0);

  return (
    <header
      className={`flex-none min-w-0 flex flex-col justify-center${split ? ' items-center text-center' : ''}`}
      style={{
        height: c(CLASS_HEAD_UC),
        marginBottom: c(CLASS_HEAD_GAP_UC),
        paddingInline: u(0.3),
      }}
    >
      {/* Not on the split board, where the half is headed by the class name
          alone: ring, division and discipline over it repeated what the name
          already says. The header keeps its pinned height either way, which
          the fit arithmetic in `scaleFor` counts on. */}
      {!split && (
        <div
          className="font-medium tracking-wide truncate max-w-full"
          style={{
            fontSize: c(0.95),
            color: 'var(--on-slate-muted)',
          }}
        >
          {context || 'Class results'}
        </div>
      )}

      <div
        className={`flex items-center min-w-0 max-w-full${split ? ' justify-center' : ''}`}
        style={{ gap: c(0.8) }}
      >
        <h2
          className="font-bold min-w-0"
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

        {/* Said on every screen, so somebody who placed sixth reads it as the
            board's rule rather than as their placing having gone missing —
            and beside the name, so it reads as part of what this class is
            showing. The QR code's "Scan for full results" is the rest. */}
        {placed && <TopBadge />}

        {/* On the split board the context line is gone, and which judges of
            the panel this is is the one thing on it the name does not say. */}
        {split && turn && (
          <span
            className="flex-none font-medium whitespace-nowrap"
            style={{ fontSize: c(1.05), color: 'var(--on-slate-muted)' }}
          >
            {turn}
          </span>
        )}
      </div>
    </header>
  );
}

function TopBadge() {
  return (
    <span
      className="flex-none rounded-full font-bold whitespace-nowrap"
      style={{
        fontSize: c(1.25),
        padding: `${c(0.25)} ${c(0.9)}`,
        backgroundColor: 'var(--accent-light)',
        color: 'var(--brand-slate)',
      }}
    >
      Top {TOP_PLACES}
    </span>
  );
}

/** One screenful: the class, and its judges' cards side by side under it.
 *
 *  `unitVh` is the preset's --u and `scale` how far this class's cards are
 *  drawn below it so every one of its top five fits (1 almost always; see
 *  `scaleFor`). The cards get their own --u, the header keeps the board's.
 *  `stageU` is the stage's measured width in the board's --u, which is what
 *  says whether a card is narrow enough to need the compact row. */
function ClassBlock({
  block,
  stageU,
  unitVh,
  scale,
  split = false,
}: {
  block: Block;
  stageU: number;
  unitVh: number;
  scale: number;
  /** On the split board: the header is centred over its half, so the two
   *  read as two sections of one screen, and carries the class name alone
   *  (see ClassHeader). The Results Board keeps it left, with its context. */
  split?: boolean;
}) {
  const judges = block.cards.length;
  const grid = screenGrid(judges);
  const cardU = (stageU / scale - GRID_GAP_U * (grid.cols - 1)) / grid.cols;
  const compact = stageU > 0 && cardU < COMPACT_CARD_U;
  // Named whenever the class has a panel, not whenever this screen shows more
  // than one card: the third judge of three, on a split-board turn of its own,
  // is one card and still somebody's.
  const named = block.cards.some((card) => card.judge != null);

  return (
    <section className="w-full h-full flex flex-col min-h-0 min-w-0 animate-[board-fade-in_0.4s_ease-out]">
      <ClassHeader block={block} split={split} />
      <div
        className="flex-1 min-h-0 grid"
        style={
          {
            '--u': `${(unitVh * scale).toFixed(3)}vh`,
            gap: u(GRID_GAP_U),
            gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
          } as React.CSSProperties
        }
      >
        {block.cards.map((card, i) => (
          <JudgeBox key={card.judge ?? i} card={card} named={named} compact={compact} />
        ))}
      </div>
    </section>
  );
}

/** Where the stage has nothing to show yet: no class posted, no points. */
function BoardNotice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex-1 min-w-0 flex flex-col items-center justify-center text-center">
      <div className="font-semibold" style={{ fontSize: u(3), color: 'var(--on-slate)' }}>
        {title}
      </div>
      <p
        style={{
          fontSize: u(1.6),
          marginTop: u(0.8),
          maxWidth: u(34),
          color: 'var(--on-slate-muted)',
        }}
      >
        {children}
      </p>
    </div>
  );
}

/* ── The split board: results beside high point ─────────────────────────────
   The same board halved (`layout="split"`, at `/board/results-high-point`):
   the class on the left, two of its judges' cards at a time, and the show's
   high point standings on the right, two at a time — each a division,
   "Amateur", its points added up across every discipline. Four
   quarter-width boxes across the screen — the width a four-judge class's cards
   already are on the Results Board, so every size, the compact row and the
   top five all carry over unchanged.

   **A panel of more than two takes turns**: judges one and two, then three
   and four, with the header saying which ("Judges 1–2 of 4"). A class with a
   single card, or the third judge of three, gets the whole half. A standings
   table left over on its own gets the whole half the same way.

   **A standing reads like a placing**: the same rosette for its rank and the
   back number in the same place, so a room finds its number and its colour
   on either half without learning a second layout.

   **Both halves turn together**, each through its own list, on the board's
   one clock — so the dwell bar still means "this screen is about to change",
   and a pause holds both. */

const SPLIT_CARDS = 2;
const SPLIT_DIVISIONS = 2;
/** Either side of the rule between the halves, and the rule, in --u. The
 *  rule is in the accent colour and the gutter wider than the gap between
 *  two cards: drawn in the boxes' own grey, a hair wide, it vanished between
 *  them and the two halves read as one row of four. */
const SPLIT_GAP_U = 2.4;
const SPLIT_RULE_U = 0.3;

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** A class's cards two at a time, one turn per pair. */
function buildSplitBlocks(blocks: Block[]): Block[] {
  return blocks.flatMap((block) => {
    const of = block.cards.length;
    if (of <= SPLIT_CARDS) return [block];
    return chunk(block.cards, SPLIT_CARDS).map((cards, i) => ({
      cls: block.cls,
      cards,
      part: { from: i * SPLIT_CARDS + 1, to: i * SPLIT_CARDS + cards.length, of },
    }));
  });
}

/* A division's standings go as deep as a class card: the top five **ranks**,
   never splitting a tie (`topStandings`). A class card can show every horse in
   a tie for fifth because there are rarely more than two; a division early in
   a show has whole runs of pairs on the same points. So standings stop at the
   rows a card with a tie for fifth takes, and a longer tie is one line, "4
   tied for 5th" — still nobody chosen, still no more than five places. */
const STANDING_ROWS = TOP_PLACES + 1;

/* A standing's points and the word under them, in --u. Larger than the
   exhibitor's name: the points are what the high point half is showing. */
const POINTS_U = 2.35;
const POINTS_UNIT_U = 1.1;
/** A standings box's title, "Amateur" — a judge's name is 1.15. */
const DIVISION_TITLE_U = 1.4;
/** One dot of a leader and the space after it; a leader is never narrower. */
const LEADER_DOT_U = 0.6;

type DivisionPane = { name: string; lines: StandingLine[] };

/** The marquee's High Point mode: a line per standings table, the same top
 *  five the board's right half shows (`topStandings`), so the band and the
 *  boxes never disagree about how deep the standings go. Each line says
 *  "High Point" first, so a room reading a placings line and then this one
 *  can tell a class from a standings table. */
function highPointLines(leaderboard: ShowLeaderboard | null): string[] {
  if (!leaderboard?.point_system) return [];
  const pts = (points: number) => `${formatPoints(points)} ${points === 1 ? 'pt' : 'pts'}`;
  return leaderboard.divisions.map((division) => {
    const summary = topStandings(division.standings, TOP_PLACES, STANDING_ROWS)
      .map((line) => {
        if (line.kind === 'tied') return `${line.count} tied for ${placeOrdinal(line.rank)} (${pts(line.points)})`;
        const s = line.standing;
        const who = [s.exhibitor_name, s.horse_name].filter(Boolean).join(' · ');
        const back = s.back_number != null ? `#${s.back_number} ` : '';
        return `${placeOrdinal(s.rank)} ${back}${who} (${pts(s.points)})`;
      })
      .join('  ·  ');
    return `High Point · ${division.name}: ${summary}`;
  });
}

function StandingRow({ line, compact }: { line: StandingLine; compact: boolean }) {
  const rank = line.kind === 'pair' ? line.standing.rank : line.rank;
  const points = line.kind === 'pair' ? line.standing.points : line.points;
  const pair = line.kind === 'pair' ? line.standing : null;
  const back = pair?.back_number != null ? `#${pair.back_number}` : null;
  const backBelow = compact && back;
  return (
    <li className="flex items-center" style={{ gap: u(0.8), height: u(ROW_U) }}>
      {/* The same rosette as the placings beside it, so the two halves read
          alike across a room: first in the standings is a blue, as first in
          the class is. */}
      <Ribbon
        place={rank}
        numberSize={14}
        style={{
          flex: 'none',
          width: u(RIBBON_U),
          height: u((RIBBON_U * 44) / 32),
        }}
      />

      {/* Laid out as a placing row is — the back number beside the name on a
          wide box and down on the horse's line on a narrow one
          (COMPACT_CARD_U) — so a room finds its number in the same place on
          both halves. No "(tie)" as a class card has: the rank says it — 1, 1
          on the same points — and on a quarter-width box the word cost the
          exhibitor all but three letters of their name. */}
      <span className="min-w-0 flex-1">
        {/* No gap on the line itself: it would stand between the name and the
            leader as well, and a narrow box needs every letter. The leader's
            first dot sits half a tile in, which is the space it needs. */}
        <span className="flex items-baseline">
          {back && !compact && (
            <span
              className="flex-none font-semibold tabular-nums"
              style={{
                fontSize: u(BACK_NUMBER_U),
                lineHeight: 1.05,
                marginRight: u(0.45),
                color: 'var(--on-slate-muted)',
              }}
            >
              {back}
            </span>
          )}
          <span
            className="truncate font-semibold"
            style={{ fontSize: u(1.85), lineHeight: 1.05, color: 'var(--on-slate)' }}
          >
            {line.kind === 'pair' ? line.standing.exhibitor_name : `${line.count} tied for ${placeOrdinal(rank)}`}
          </span>
          {/* Dot leaders to the points, as a printed standings sheet runs
              them: in a wide box the name and its points sit a quarter of a
              screen apart, and across a room the eye loses which figure
              belongs to which line. Round dots at mid-height, spaced, drawn
              whole (\`space\`): on the baseline they read as an ellipsis after
              a truncated name — "Ca... ....". At least one dot on every row,
              and no more than that taken from a name a narrow box has already
              cut short. */}
          <span
            aria-hidden="true"
            className="flex-1"
            style={{
              minWidth: u(LEADER_DOT_U),
              height: u(LEADER_DOT_U),
              // Off the last letter: `space` puts the first dot against the
              // leader's edge, and the name's last glyph has no side bearing.
              marginLeft: u(0.3),
              alignSelf: 'center',
              backgroundImage: `radial-gradient(circle, var(--on-slate-muted) ${u(0.13)}, transparent ${u(0.15)})`,
              backgroundSize: `${u(LEADER_DOT_U)} ${u(LEADER_DOT_U)}`,
              backgroundRepeat: 'space no-repeat',
              backgroundPosition: 'left center',
            }}
          />
        </span>
        {(backBelow || pair?.horse_name) && (
          <span
            className="block truncate"
            style={{ fontSize: u(1.2), lineHeight: 1.15, color: 'var(--on-slate-muted)' }}
          >
            {backBelow && (
              <span className="tabular-nums" style={{ fontSize: u(BACK_NUMBER_COMPACT_U) }}>
                {back}
                {pair?.horse_name ? ' · ' : ''}
              </span>
            )}
            {pair?.horse_name}
          </span>
        )}
      </span>

      {/* The figure the half is about, so it is the largest thing on the row,
          with its unit set in the same colour under it: a bare number beside
          a name read from across a room as a back number or a place. Both
          lines together stay inside ROW_U. */}
      <span className="flex-none text-right">
        <span
          className="block font-bold tabular-nums"
          style={{ fontSize: u(POINTS_U), lineHeight: 1.0, color: 'var(--accent-light)' }}
        >
          {formatPoints(points)}
        </span>
        <span
          className="block font-semibold uppercase tracking-wide"
          style={{ fontSize: u(POINTS_UNIT_U), lineHeight: 1.1, color: 'var(--accent-light)' }}
        >
          {points === 1 ? 'pt' : 'pts'}
        </span>
      </span>
    </li>
  );
}

/** One division's standings, shaped like a judge's card beside it: "Amateur"
 *  where the judge's name goes, and the rows at the same height. */
function DivisionBox({ pane, compact }: { pane: DivisionPane; compact: boolean }) {
  return (
    <div className="flex flex-col min-h-0 min-w-0 overflow-hidden" style={PANE_STYLE}>
      {/* Larger than a judge's name and centred in the box: it is the title of
          the table under it, where a judge's name is a label on a card. Still
          one line inside JUDGE_HEAD_U, which the fit arithmetic counts. The
          ellipsis is on the inner span — on the flex box itself it would
          never show, the text being an anonymous flex item. */}
      <div
        className="font-semibold flex-none flex items-center justify-center min-w-0"
        style={{ fontSize: u(DIVISION_TITLE_U), height: u(JUDGE_HEAD_U), color: 'var(--accent-light)' }}
      >
        <span className="truncate min-w-0">{pane.name}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col" style={{ justifyContent: 'safe center' }}>
        <ul className="min-w-0">
          {pane.lines.map((line, i) => (
            <StandingRow key={i} line={line} compact={compact} />
          ))}
        </ul>
      </div>
    </div>
  );
}

/** The high point half's header, the same pinned height as a class's so the
 *  boxes under both start on one line, and centred over its half as the
 *  class's is over the other. "High Point" and the badge alone: the points
 *  system and the posted-class count over it only restated the heading. */
function HighPointHeader() {
  return (
    <header
      className="flex-none min-w-0 flex flex-col justify-center items-center text-center"
      style={{
        height: c(CLASS_HEAD_UC),
        marginBottom: c(CLASS_HEAD_GAP_UC),
        paddingInline: u(0.3),
      }}
    >
      <div className="flex items-center justify-center min-w-0 max-w-full" style={{ gap: c(0.8) }}>
        <h2 className="font-bold truncate min-w-0" style={{ fontSize: c(1.5), lineHeight: 1.05, color: 'var(--on-slate)' }}>
          High Point
        </h2>
        <TopBadge />
      </div>
    </header>
  );
}

/** The right half: two standings tables, or why there are none — said
 *  without the header, so it sits level with "Waiting on results" beside it. */
function HighPointBlock({
  leaderboard,
  panes,
  stageU,
  unitVh,
  scale,
}: {
  leaderboard: ShowLeaderboard | null;
  panes: DivisionPane[];
  /** The half's width in the board's --u, which decides the compact row
   *  exactly as it does for the judges' cards beside it. */
  stageU: number;
  unitVh: number;
  scale: number;
}) {
  const cols = Math.max(panes.length, 1);
  const boxU = (stageU / scale - GRID_GAP_U * (cols - 1)) / cols;
  const compact = stageU > 0 && boxU < COMPACT_CARD_U;
  return (
    <section className="w-full h-full flex flex-col min-h-0 min-w-0 animate-[board-fade-in_0.4s_ease-out]">
      {panes.length > 0 && leaderboard?.point_system ? (
        <>
          <HighPointHeader />
          <div
            className="flex-1 min-h-0 grid"
            style={
              {
                '--u': `${(unitVh * scale).toFixed(3)}vh`,
                gap: u(GRID_GAP_U),
                gridTemplateColumns: `repeat(${panes.length}, minmax(0, 1fr))`,
              } as React.CSSProperties
            }
          >
            {panes.map((pane) => (
              <DivisionBox key={pane.name} pane={pane} compact={compact} />
            ))}
          </div>
        </>
      ) : !leaderboard ? (
        // The poll brings it back; nothing for the room to do about it.
        <BoardNotice title="High Point">The standings will be back in a moment.</BoardNotice>
      ) : !leaderboard.point_system ? (
        <BoardNotice title="No high point">High point is not being kept at this show.</BoardNotice>
      ) : (
        <BoardNotice title="High Point">
          Standings start as soon as the first class is judged and its placings are posted.
        </BoardNotice>
      )}
    </section>
  );
}

/** The split board's stage: the class on the left, the standings on the
 *  right, an accent rule in a wide gutter between (SPLIT_GAP_U, SPLIT_RULE_U). Each half is keyed on its own turn, so a half
 *  whose list has only one entry stays put while the other turns over. */
function SplitStage({
  active,
  activeKey,
  panes,
  panesKey,
  leaderboard,
  stageU,
  unitVh,
  scale,
}: {
  active: Block | null;
  activeKey: number;
  panes: DivisionPane[];
  panesKey: number;
  leaderboard: ShowLeaderboard | null;
  stageU: number;
  unitVh: number;
  scale: number;
}) {
  const halfU = stageU > 0 ? (stageU - 2 * SPLIT_GAP_U - SPLIT_RULE_U) / 2 : 0;
  return (
    <div className="w-full h-full min-h-0 min-w-0 flex">
      <div className="flex-1 min-w-0 min-h-0 flex">
        {active ? (
          <ClassBlock key={activeKey} block={active} stageU={halfU} unitVh={unitVh} scale={scale} split />
        ) : (
          <BoardNotice title="Waiting on results">
            Posted placings will show here as soon as the first class of the day goes up.
          </BoardNotice>
        )}
      </div>
      <div
        aria-hidden="true"
        className="flex-none"
        style={{
          width: u(SPLIT_RULE_U),
          marginInline: u(SPLIT_GAP_U),
          borderRadius: u(SPLIT_RULE_U),
          backgroundColor: 'var(--accent-light)',
          opacity: 0.55,
        }}
      />
      <div className="flex-1 min-w-0 min-h-0 flex">
        <HighPointBlock
          key={panesKey}
          leaderboard={leaderboard}
          panes={panes}
          stageU={halfU}
          unitVh={unitVh}
          scale={scale}
        />
      </div>
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
 *  to the results if a message mode has nothing to say or the high point has
 *  no points chart. */
function marqueeItems(
  mode: MarqueeMode,
  message: string | null,
  results: string[],
  highPoint: string[],
): TickerItem[] {
  if (mode === 'high_point') {
    // A chart with nothing posted against it yet has no standings to scroll:
    // the results carry on until the first class goes up, rather than the
    // band going blank.
    return (highPoint.length ? highPoint : results).map((text): TickerItem => ({ text, kind: 'result' }));
  }
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
  // An iPhone has no full screen for a page at all, and asking somebody to
  // press a button that cannot work is worse than not asking.
  const [canFullscreen, setCanFullscreen] = useState(false);
  // Between asking and the browser answering. A duplicated board asks on the
  // very press that starts it, and without this the *Fill the screen* prompt
  // would flash up for the frame or two before the answer arrives.
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    setCanFullscreen(document.fullscreenEnabled === true);
    const onChange = () => setIsFullscreen(document.fullscreenElement != null);
    onChange();
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const enter = useCallback(() => {
    const root = document.documentElement;
    if (document.fullscreenElement || typeof root.requestFullscreen !== 'function') return;
    // A refused request — an iframe with no `allow`, a gesture the browser did
    // not count — rejects rather than throwing, and the board carries on
    // exactly as it was.
    setRequesting(true);
    void Promise.resolve(root.requestFullscreen())
      .catch(() => {})
      .finally(() => setRequesting(false));
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      enter();
    }
  }, [enter]);

  return { isFullscreen, canFullscreen, requesting, enter, toggle };
}

/** Keeps the display awake while a duplicated board runs.
 *
 *  A tablet on the back of a monitor locks itself after a couple of minutes of
 *  nobody touching it, and the mirrored monitor goes dark with it — the board
 *  is a page nobody touches, by design. The browser drops the lock whenever
 *  the page is hidden, so it is taken again each time the page comes back.
 *  Refused (battery saver, a browser without the API), the board runs exactly
 *  as before. */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let asking = false;
    let stopped = false;

    const acquire = async () => {
      if (stopped || asking || document.visibilityState !== 'visible') return;
      if (sentinel && !sentinel.released) return;
      asking = true;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (stopped) void next.release().catch(() => {});
        else sentinel = next;
      } catch {
        // Refused. Nothing to do but carry on.
      } finally {
        asking = false;
      }
    };

    void acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', acquire);
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => {});
    };
  }, [on]);
}

/* ── On a monitor ──────────────────────────────────────────────────────────
   Two ways a monitor plugged into a laptop or tablet can show the board:
   extended, where the board gets the monitor to itself in a window of its own
   (`openOnSecondScreen`, `?popout=1`) and this screen stays free; or
   duplicated, where the monitor mirrors this screen — the only thing a tablet
   mounted on the back of a TV can do — so the board runs in this tab and fills
   it (`?duplicate=1`). Either way it is only right full screen, and a browser
   goes full screen only on a press in that window, so a board that is not
   asks for one. */

const FILL_PROMPT = {
  extend: {
    button: '⛶ Fill this screen',
    note: 'The results board, on its own screen. The laptop or tablet it came from stays free.',
    keep: 'Keep it in a window',
  },
  duplicate: {
    button: '⛶ Fill the screen',
    note: 'The monitor shows this screen, so the board fills both.',
    keep: 'Keep the browser showing',
  },
};

// The Window Management API (Chrome and Edge on desktop), which is what lets a
// page find a monitor plugged into the laptop and put a window on it. Not in
// TypeScript's DOM library yet, so the few members used are declared here.
type ScreenDetailed = {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  label?: string;
};
type ScreenDetails = { screens: ScreenDetailed[]; currentScreen: ScreenDetailed };

/** Named, so opening the board a second time reuses its window rather than
 *  stacking another one onto the TV. */
const BOARD_WINDOW = 'gaitdesk-results-board';

type SecondScreenResult =
  | { kind: 'blocked' }
  | { kind: 'placed'; win: Window; screen: string | null }
  | { kind: 'window'; win: Window; reason: 'unsupported' | 'refused' | 'no-second-screen' };

/**
 * Open the running board in a window of its own, on the monitor attached to
 * this laptop or tablet where the browser can find one.
 *
 * The window opens **first**, while the press still counts as a user gesture —
 * asking for screen access can put up a permission prompt, and by the time it
 * is answered the gesture has expired and a popup would be blocked. It is then
 * moved onto the other screen and sized to fill it. A browser without the API,
 * a refused permission, or a display set to mirror all leave the window open
 * here to be dragged across.
 */
async function openOnSecondScreen(url: string): Promise<SecondScreenResult> {
  const win = window.open(url, BOARD_WINDOW, 'popup,width=1280,height=720');
  if (!win) return { kind: 'blocked' };

  const getScreenDetails = (window as Window & { getScreenDetails?: () => Promise<ScreenDetails> })
    .getScreenDetails;
  if (!getScreenDetails) return { kind: 'window', win, reason: 'unsupported' };

  let details: ScreenDetails;
  try {
    details = await getScreenDetails.call(window);
  } catch {
    return { kind: 'window', win, reason: 'refused' };
  }
  // Any screen but the one this page is on, largest first: with a TV and a
  // small second monitor both plugged in, the TV is the likelier target.
  const others = details.screens
    .filter((s) => s !== details.currentScreen)
    .sort((a, b) => b.availWidth * b.availHeight - a.availWidth * a.availHeight);
  const target = others[0];
  if (!target) return { kind: 'window', win, reason: 'no-second-screen' };

  try {
    win.moveTo(target.availLeft, target.availTop);
    win.resizeTo(target.availWidth, target.availHeight);
  } catch {
    return { kind: 'window', win, reason: 'refused' };
  }
  return { kind: 'placed', win, screen: target.label || null };
}

const MARQUEE_MODES: { key: MarqueeMode; label: string; hint: string }[] = [
  {
    key: 'results',
    label: 'Results',
    hint: 'The latest placings, a line per class',
  },
  { key: 'message', label: 'Message', hint: 'Your message, and nothing else' },
  { key: 'both', label: 'Both', hint: 'Your message, between the results' },
  // Offered on both boards' pages, because the marquee is one setting for the
  // show: whichever board is up scrolls it.
  { key: 'high_point', label: 'High Point', hint: 'The standings, a line per division' },
];

/** The modes that scroll the message, and so need one typed. */
const MESSAGE_MODES: MarqueeMode[] = ['message', 'both'];

/** Why High Point cannot be chosen, when it cannot. */
const NO_HIGH_POINT = 'This show has no points chart — choose one on its High Point page';

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
  const needsMessage = MESSAGE_MODES.includes(mode) && !text;
  const highPointAvailable = marquee.high_point_available === true;
  const needsChart = mode === 'high_point' && !highPointAvailable;

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
      : needsChart
        ? NO_HIGH_POINT
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
        className="grid grid-cols-2 sm:grid-cols-4"
        style={{ gap: '1vh' }}
      >
        {MARQUEE_MODES.map((m) => {
          const on = mode === m.key;
          // Offered, and says why it cannot be chosen, rather than missing:
          // a show that adds a chart later should know where the option is.
          const unavailable = m.key === 'high_point' && !highPointAvailable;
          return (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={unavailable}
              title={unavailable ? NO_HIGH_POINT : undefined}
              onClick={() => {
                setMode(m.key);
                setSaved(false);
              }}
              className="rounded-lg text-left transition disabled:opacity-50 disabled:cursor-not-allowed"
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
            {!MESSAGE_MODES.includes(mode) && text
              ? ` — kept, but not scrolling while ${mode === 'high_point' ? 'High Point' : 'Results'} is chosen`
              : ''}
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
 *  the office while a board runs somewhere else.
 *
 *  **Or on a monitor plugged in**, duplicated or extended — see the note above
 *  `FILL_PROMPT`. Extended, a laptop or tablet with a TV plugged in does not
 *  have to give its own screen up to the board: choosing *Extend screen* opens
 *  the board in a window of its own on the attached monitor
 *  (`openOnSecondScreen`), and this page stays here, free for the desk. */
function ResultsBoardSetup({
  showId,
  showName,
  title,
  notice,
  marquee,
  initialDuplicate,
  onPick,
}: {
  showId: string;
  showName: string;
  /** Which board this page starts: the Results Board, or Results & High Point. */
  title: string;
  /** Something the office should know before putting this board up. */
  notice?: React.ReactNode;
  marquee: Marquee;
  /** Reached through the Settings of a duplicated board. */
  initialDuplicate: boolean;
  onPick: (k: SizeKey, duplicate: boolean) => void;
}) {
  const card = {
    padding: '2.4vh',
    backgroundColor: 'var(--slate-raised)',
    border: '0.2vh solid var(--on-slate-muted)',
    color: 'var(--on-slate)',
  } as const;

  const [target, setTarget] = useState<'here' | 'duplicate' | 'second'>(initialDuplicate ? 'duplicate' : 'here');
  const [opened, setOpened] = useState<SecondScreenResult | null>(null);

  const pick = async (key: SizeKey) => {
    if (target !== 'second') {
      onPick(key, target === 'duplicate');
      return;
    }
    // The screen time and anything else in the query travel with the board.
    const q = new URLSearchParams(window.location.search);
    q.set('size', key);
    q.set('popout', '1');
    q.delete('duplicate');
    setOpened(await openOnSecondScreen(`${window.location.pathname}?${q.toString()}`));
  };

  const openedNote =
    opened == null
      ? null
      : opened.kind === 'blocked'
        ? 'The browser blocked the board’s window. Allow pop-ups for this site, then pick the size again.'
        : opened.kind === 'placed'
          ? `The board is running on ${opened.screen ? `“${opened.screen}”` : 'the second screen'}. Move the mouse onto it and press Fill this screen. This one stays free — close the board’s window to stop it.`
          : opened.reason === 'no-second-screen'
            ? 'No second screen was found, so the board opened in a window here. Check the display is set to extend, not mirror, then drag the window across and press Fill this screen.'
            : 'The board opened in its own window. Drag it onto the second screen and press Fill this screen — this one stays free.';

  const seg = (on: boolean) =>
    ({
      fontSize: 'max(14px, 1.9vh)',
      padding: '0.9vh 1.6vh',
      backgroundColor: on ? 'var(--accent)' : 'var(--slate-raised)',
      color: on ? 'var(--accent-foreground)' : 'var(--on-slate-muted)',
      border: '0.2vh solid var(--on-slate-muted)',
    }) as const;

  const targets = [
    { key: 'here', label: 'This screen', title: undefined },
    {
      key: 'duplicate',
      label: 'Duplicate screen',
      title:
        'A monitor showing the same picture as this tablet or laptop. The board fills this screen, so it fills the monitor too.',
    },
    {
      key: 'second',
      label: 'Extend screen',
      title:
        'A TV or monitor plugged into this laptop or tablet. The board gets its own window there, and this screen stays free.',
    },
  ] as const;

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="mx-auto flex flex-col" style={{ maxWidth: '150vh', padding: '4vh 16px', gap: '3.6vh' }}>
        <header className="flex items-end justify-between flex-wrap" style={{ gap: '1.4vh' }}>
          <div className="min-w-0">
            <h1 className="font-bold" style={{ fontSize: 'max(24px, 4.2vh)', color: 'var(--on-slate)' }}>
              {title}
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

        {notice && (
          <p
            role="status"
            className="rounded-lg"
            style={{
              fontSize: 'max(14px, 1.9vh)',
              padding: '1.4vh 1.8vh',
              backgroundColor: 'var(--slate-raised)',
              border: '0.2vh solid var(--warning)',
              color: 'var(--on-slate)',
            }}
          >
            {notice}
          </p>
        )}

        <section>
          <HubHeading
            title="Where is this screen?"
            note="A browser is never told how big its screen is, and a lobby TV needs letters several times taller than a desk monitor. Pick one and the board starts."
          />
          <div className="flex flex-wrap items-center" style={{ gap: '1vh', marginBottom: '2vh' }} role="group" aria-label="Which screen shows the board">
            {targets.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  setTarget(t.key);
                  setOpened(null);
                }}
                aria-pressed={target === t.key}
                className="rounded-lg font-semibold"
                style={seg(target === t.key)}
                title={t.title}
              >
                {t.label}
              </button>
            ))}
            {target !== 'here' && (
              <span style={{ fontSize: 'max(13px, 1.7vh)', color: 'var(--on-slate-muted)' }}>
                {target === 'duplicate'
                  ? 'The monitor shows the same picture as this tablet or laptop. Pick the monitor’s size below.'
                  : 'The one plugged into this laptop or tablet, set to extend the display.'}
              </span>
            )}
          </div>
          {openedNote && (
            <p
              role="status"
              className="rounded-lg"
              style={{
                fontSize: 'max(14px, 1.9vh)',
                padding: '1.2vh 1.6vh',
                marginBottom: '2vh',
                backgroundColor: 'var(--slate-raised)',
                color: opened?.kind === 'blocked' ? 'var(--warning)' : 'var(--on-slate)',
              }}
            >
              {openedNote}
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3" style={{ gap: '2vh' }}>
            {SIZE_ORDER.map((key, i) => {
              const p = PRESETS[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => void pick(key)}
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
                    {/* The number keys start the board on this screen, never
                        duplicated or on the second screen. */}
                    {target === 'here'
                      ? `Press ${i + 1}`
                      : target === 'duplicate'
                        ? 'Fills this screen and the monitor'
                        : 'Opens on the second screen'}
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

/** `i` wrapped into 0..n-1, negatives included — the rotation's clock only
 *  counts up (or down, stepping back), and each list takes its own turn off it. */
const wrap = (i: number, n: number) => ((i % n) + n) % n;

export default function LiveBoard({
  showId,
  show,
  classes,
  resultsIndex,
  marquee,
  layout = 'results',
  leaderboard = null,
}: {
  showId: string;
  show: ShowInfo;
  classes: ClassItem[];
  resultsIndex: Record<string, Placing[]>;
  marquee: Marquee;
  /** `split`: results on the left, high point on the right. See the note
   *  above `SPLIT_CARDS`. */
  layout?: 'results' | 'split';
  /** The show's standings, for the split board. Null when they could not be
   *  loaded, which the high point half says. */
  leaderboard?: ShowLeaderboard | null;
}) {
  const split = layout === 'split';
  const boardName = split ? 'Results & High Point' : 'Results Board';
  const [now, setNow] = useState(() => new Date());
  // Counts turns and never wraps: the split board's two halves each take their
  // own position off it (`wrap`), since they run through lists of different
  // lengths.
  const [tick, setTick] = useState(0);
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
  // Started for a monitor from the Results Board page: extended, in a window of
  // its own on the monitor, or duplicated, in this tab on a tablet or laptop
  // the monitor mirrors. See the note above FILL_PROMPT.
  const popout = searchParams.get('popout') === '1';
  const duplicate = searchParams.get('duplicate') === '1';
  const fillPrompt = popout ? FILL_PROMPT.extend : duplicate ? FILL_PROMPT.duplicate : null;
  const [keepWindowed, setKeepWindowed] = useState(false);

  // Nothing renders until mounted: the board is laid out from the window's
  // height and shows a clock, and neither exists on the server. Rendering
  // them there would be a wrong-scale frame and a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [vh, setVh] = useState(0);
  const [gridRef, gridBox] = useBoxSize();

  const {
    isFullscreen,
    canFullscreen,
    requesting: fullscreenRequested,
    enter: enterFullscreen,
    toggle: toggleFullscreen,
  } = useFullscreen();

  useWakeLock(size !== null && duplicate);

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

  // Starting from the Results Board page. Duplicated, full screen is asked for
  // on the press that starts the board, while the press still counts as one:
  // this screen *is* the monitor, and a tab strip and address bar across the
  // top of a lobby TV is the first thing the room would read.
  const start = useCallback(
    (k: SizeKey, dup: boolean) => {
      if (dup) enterFullscreen();
      setKeepWindowed(false);
      setQuery({ size: k, duplicate: dup ? '1' : null }, 'push');
    },
    [enterFullscreen, setQuery],
  );

  // `?duplicate=1` stays in the URL, so the page comes back with Duplicate
  // screen chosen.
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

  // A class's placings split by judge, computed once: how its cards are laid
  // out is decided by how many there are, and the blocks are built from the
  // same list.
  const groups = useMemo(
    () => postedToday.map((cls) => groupByJudge(resultsIndex[cls.id] ?? [])),
    [postedToday, resultsIndex],
  );

  // How far a class's cards are drawn below the preset's size so that every
  // row of its deepest card fits — 1, unless the letters are too big for the
  // stage (a four-judge class at the lobby size). Taken from the stage the
  // browser actually handed us rather than from a breakpoint or a guess at
  // type metrics, so the same arithmetic covers every panel in the range, the
  // 4K ones and the odd 21:9 included.
  //
  // Everything in a box scales with its --u — padding, the judge's name, the
  // rows, and the gaps between boxes — so the whole card is one sum in units.
  // The class header over it is in the chrome's unit and does not scale. A
  // couple of pixels are held back so rounding never slices the last row.
  const scaleFor = useMemo(() => {
    if (!uPx || !gridBox.h) return () => 1;
    const available = gridBox.h - (CLASS_HEAD_UC + CLASS_HEAD_GAP_UC) * ucPx - 2;
    return (judges: number, rows: number) => {
      const g = screenGrid(judges);
      const box = PANE_PAD_U + (judges > 1 ? JUDGE_HEAD_U : 0) + Math.max(rows, 1) * ROW_U;
      const needU = box * g.rows + GRID_GAP_U * (g.rows - 1);
      return Math.min(1, available / (needU * uPx));
    };
  }, [uPx, ucPx, gridBox.h]);

  const slides = useMemo(() => {
    const blocks = buildBlocks(postedToday, groups);
    return split ? buildSplitBlocks(blocks) : blocks;
  }, [postedToday, groups, split]);

  // The high point half's turns, two standings tables each. The whole show's
  // standings, not the day's: points add up across every posted class.
  const divisionSlides = useMemo(() => {
    if (!split || !leaderboard?.point_system) return [];
    const panes = leaderboard.divisions.map(
      (d): DivisionPane => ({ name: d.name, lines: topStandings(d.standings, TOP_PLACES, STANDING_ROWS) }),
    );
    return chunk(panes, SPLIT_DIVISIONS);
  }, [split, leaderboard]);

  const turns = Math.max(slides.length, divisionSlides.length);
  const active = slides.length ? slides[wrap(tick, slides.length)] : null;
  const panes = divisionSlides.length ? divisionSlides[wrap(tick, divisionSlides.length)] : [];
  const paneRows = panes.reduce((n, pane) => n + pane.lines.length, 0);
  // A screen time the office chose is taken exactly, with no pricing and no
  // preset factor on top: somebody who picked "30 sec" is timing it.
  const dwellMs =
    turns === 0
      ? 0
      : every != null
        ? every * 1000
        : slideMs((active ? blockPlacings(active) : 0) + paneRows, preset.dwell);

  useEffect(() => {
    if (paused || turns < 2) return;
    const t = setTimeout(() => setTick((i) => i + 1), dwellMs);
    return () => clearTimeout(t);
    // Keyed on the numbers rather than on the slide object: a poll that changes
    // nothing rebuilds `slides` but leaves these equal, so the rotation carries
    // on from where it was instead of snapping back to the first class.
  }, [tick, turns, dwellMs, paused]);

  const step = useCallback((delta: number) => {
    setPaused(true); // stepping by hand means you want to look at it
    setTick((i) => i + delta);
  }, []);

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
        // From the Results Board page the number keys start the board on this
        // screen, never duplicated or on the second screen.
        if (size) choose(SIZE_ORDER[Number(e.key) - 1], 'replace');
        else start(SIZE_ORDER[Number(e.key) - 1], false);
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
  }, [choose, start, step, wake, toggleFullscreen, size]);

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
        // The same top five the panes carry, so the marquee and the grid
        // never disagree about how deep the board goes.
        const placed = topPlacings(g.rows);
        const summary = placed.map((r) => `${placeOrdinal(r.place!)} ${rowLabel(r)}`).join('  ·  ');
        const surname = judgeSurname(g.rows);
        items.push(`${head}${surname ? ` · Judge ${surname}` : ''}: ${summary || 'no placings yet'}`);
      }
    });
    return items;
  }, [postedToday, groups]);

  // Both boards can scroll the standings: the marquee is one setting for the
  // show, so the Results Board's page fetches the leaderboard for it whenever
  // High Point is chosen, and the split board always has it.
  const standingLines = useMemo(() => highPointLines(leaderboard), [leaderboard]);

  const tickerItems = useMemo(
    () => marqueeItems(marquee.effective_mode, marquee.message, resultLines, standingLines),
    [marquee.effective_mode, marquee.message, resultLines, standingLines],
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
          title={boardName}
          notice={
            split && leaderboard && !leaderboard.point_system ? (
              <>
                This show has no points chart, so the high point half of the board will say high point is not
                being kept.{' '}
                <Link
                  href={`/admin/shows/${showId}/high-point`}
                  className="underline"
                  style={{ color: 'var(--accent-light)' }}
                >
                  Choose a chart on the High Point page →
                </Link>
              </>
            ) : undefined
          }
          marquee={marquee}
          initialDuplicate={duplicate}
          onPick={start}
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
          {fillPrompt && canFullscreen && !isFullscreen && !fullscreenRequested && !keepWindowed && (
            // A browser only goes full screen on a press in that window, so a
            // board for a monitor that is not full screen asks for one — big,
            // because on an extended screen it is being reached for with a
            // mouse dragged over from the laptop. Duplicated, it comes up after
            // Esc or a reload, with whoever did that at the keyboard.
            <div
              className="absolute inset-0 z-10 flex flex-col items-center justify-center text-center"
              style={{ backgroundColor: 'var(--slate)', gap: '2vh', padding: '0 16px' }}
            >
              <button
                type="button"
                onClick={enterFullscreen}
                className="rounded-2xl font-bold transition hover:brightness-110"
                style={{
                  fontSize: 'max(24px, 4.5vh)',
                  padding: '3vh 6vh',
                  backgroundColor: 'var(--accent)',
                  color: 'var(--accent-foreground)',
                }}
              >
                {fillPrompt.button}
              </button>
              <p style={{ fontSize: 'max(14px, 2vh)', color: 'var(--on-slate-muted)' }}>{fillPrompt.note}</p>
              <button
                type="button"
                onClick={() => setKeepWindowed(true)}
                className="hover:underline"
                style={{ fontSize: 'max(13px, 1.7vh)', color: 'var(--accent-light)' }}
              >
                {fillPrompt.keep}
              </button>
            </div>
          )}
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

            <div className="flex items-center flex-none" style={{ gap: c(1) }}>
            <div className="flex flex-col items-end" style={{ gap: c(0.4) }}>
            <div className="flex items-center" style={{ gap: c(0.5) }}>
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
            <div
              className="text-right whitespace-nowrap"
              style={{ fontSize: c(0.9), lineHeight: 1.25, color: 'var(--on-slate-muted)' }}
            >
              Scan for full results →
            </div>
            </div>
            {/* The show's public Results page, one scan from anybody watching —
                no account needed, which is why that page stays public. Built
                from the address the board itself is on, so it points at the
                right site in every environment. Sized off the chrome unit like
                the rest of the header, with a floor below which a phone at
                arm's length stops finding it. */}
            <QrCode
              value={`${window.location.origin}/shows/${showId}/results`}
              size={`max(88px, ${c(5.6)})`}
              label="QR code: this show's results"
            />
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
              opacity: !paused && turns > 1 ? 1 : 0,
            }}
          >
            {!paused && turns > 1 && (
              <div
                // Keyed on the time as well as the screen: changing the screen
                // time restarts the countdown, and the bar has to restart with
                // it rather than carry on at the old speed.
                key={`${tick}:${dwellMs}`}
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
              {split ? (
                <SplitStage
                  active={active}
                  activeKey={slides.length ? wrap(tick, slides.length) : 0}
                  panes={panes}
                  panesKey={divisionSlides.length ? wrap(tick, divisionSlides.length) : 0}
                  leaderboard={leaderboard}
                  stageU={uPx ? gridBox.w / uPx : 0}
                  unitVh={preset.scale * U_VH}
                  // One scale for both halves, so a placing and a standing are
                  // the same size and their rows run across on one line.
                  scale={scaleFor(
                    SPLIT_CARDS,
                    Math.max(active ? blockDepth(active) : 0, ...panes.map((pane) => pane.lines.length)),
                  )}
                />
              ) : active ? (
                <ClassBlock
                  key={tick}
                  block={active}
                  stageU={uPx ? gridBox.w / uPx : 0}
                  unitVh={preset.scale * U_VH}
                  scale={scaleFor(active.cards.length, blockDepth(active))}
                />
              ) : (
                <BoardNotice title="Waiting on results">
                  Posted placings will start rotating through here as soon as the first class of the day goes up.
                </BoardNotice>
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
              title={`${boardName} page — screen size and the marquee message`}
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
