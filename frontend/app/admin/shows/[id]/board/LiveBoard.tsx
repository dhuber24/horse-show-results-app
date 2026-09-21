'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { outcomeShort } from '@/lib/result-outcomes';

/* ───────────────────────────────────────────────────────────────────────────
   Sizing this for anything from 24" to 75".

   Those two ends want opposite layouts, and what separates them is not
   something the browser can measure. Both panels are almost always 1920x1080,
   and a 4K TV usually reports 1920 CSS pixels too. What differs is how far
   away the reader stands — four feet at a desk, thirty across a lobby — and
   the sign-maker's rule is about an inch of letter height per ten feet of it.
   So the same pixel grid needs letters four or five times taller in the hall,
   which means four or five times fewer of them on screen.

   No API reports a diagonal. So the board asks once, on the device that will
   display it, and remembers the answer. Everything else derives from it:

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
const STORAGE_KEY = 'gaitdesk.board.size';

/* Layout constants, in units of --u. ROW_U, JUDGE_HEAD_U and CARD_HEAD_U are
   pinned as explicit heights on the elements themselves, so the arithmetic
   deciding what fits is exact rather than a guess at what the type will
   measure out to. */
const ROW_U = 3.7; // a placing row: badge, name, horse, and the gap under it
const JUDGE_HEAD_U = 2.4; // "Judge Delgado" and its margin
/* A pane's own header — context line plus up to two lines of class name — in
   units of **--uc**, not --u. Which class this is, is context a room reads
   once; the placings are what it came for. Sized off --u it scaled with the
   results, and at the lobby preset a fixed 4.7u header ate more than half of
   a quarter-screen cell, leaving room for a single placing. Same reasoning as
   `chrome` in PRESETS, applied one level down. */
const CARD_HEAD_UC = 4.6;
const PANE_PAD_U = 1.4; // a pane's own top and bottom padding, together
const GRID_GAP_U = 1.6; // between panes, both ways
const TICKER_U_PER_SEC = 4.5; // ticker travel per second, in units, so the
// crawl reads at one speed to the eye at every scale

/* How many classes share a screen. The board carried one at a time, which
   answers "what won class 14" and not the question people actually walk up
   with — "has mine gone up yet?" — because finding out meant waiting out
   every other class of the day.

   Four at every preset is a deliberate choice and it has a cost: the
   sign-maker's rule behind PRESETS wants *fewer, larger* items the further
   away the reader is, and a quarter-screen pane at the lobby scale fits two
   or three placings rather than seven. It says so — "top 3 of 9" — rather
   than trailing off. The fit is still measured, so the pane shows whole rows
   and never a row sliced through the middle. */
const CLASSES_PER_SCREEN = 4;

/* Roughly two minutes of rotation. A morning with three classes posted can
   afford to page all the way down each one; an evening with thirty cannot, or
   somebody waiting on their class waits a quarter of an hour for it to come
   round again. This is the budget of screens divided between them — and one
   screen is now CLASSES_PER_SCREEN panes, so the budget of panes is that many
   times larger. */
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

const PLACE_COLOR: Record<number, string> = {
  1: 'var(--accent-light)',
  2: '#d9dde3',
  3: 'var(--warning)',
};

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

/* ── Panes and slides ──────────────────────────────────────────────────────
   A **pane** is one class's placings under one judge — the unit that occupies
   a cell of the grid. A **slide** is a screenful of them, CLASSES_PER_SCREEN
   at a time.

   A class with more placings than a pane fits becomes two panes rather than
   being cut off at "+7 more", and a panel-judged class becomes one pane per
   judge: at a quarter of the screen there is no width to stand two judges
   beside each other, which is what produced "Certainly Good Lo…" before.

   What it still will not do is let one class own the rotation. Every class
   gets a share of the screens; when its placings need more panes than its
   share, the ones shown say so — "top 4 of 12" — rather than trailing off and
   leaving the room to wonder whether that was the whole card.
   ────────────────────────────────────────────────────────────────────────── */

type Pane = {
  cls: ClassItem;
  /** The judge whose card this is, or null on a single-judge class. */
  judge: string | null;
  surname: string | null;
  rows: Placing[];
  page: number;
  pages: number;
  /** Set when this class is showing less than its full card. */
  shownOf: { shown: number; total: number } | null;
};

type Slide = {
  panes: Pane[];
  /** Placings on this screen, which is what its dwell is priced from. */
  rows: number;
};

/** How the screen divides. Derived from how many panes there are to show at
 *  all, so a day with two classes posted gets two half-screens rather than
 *  two quarters and a pair of holes. Fixed for the whole rotation: a grid
 *  that reshaped itself between screens would move a class somebody was
 *  halfway through reading. */
function gridShape(groupCount: number) {
  if (groupCount <= 1) return { cols: 1, rows: 1 };
  if (groupCount === 2) return { cols: 2, rows: 1 };
  return { cols: 2, rows: 2 };
}

function buildPanes(
  classes: ClassItem[],
  groups: JudgeGroup[][],
  rowsPlain: number,
  rowsJudged: number,
  perScreen: number,
): Pane[] {
  const groupCount = groups.reduce((n, g) => n + g.length, 0);
  // One screen now carries `perScreen` panes, so the budget of panes is that
  // many times the budget of screens.
  const budget = clamp(
    Math.round((CYCLE_SLIDES * perScreen) / Math.max(groupCount, 1)),
    1,
    4,
  );

  // Built per card first, then interleaved below.
  const byCard: Pane[][] = [];

  classes.forEach((cls, ci) => {
    for (const g of groups[ci]) {
      const perPage = Math.max(1, g.judge ? rowsJudged : rowsPlain);
      const pages = clamp(Math.ceil(g.rows.length / perPage), 1, budget);
      const shown = Math.min(g.rows.length, pages * perPage);
      const surname = judgeSurname(g.rows);
      const own: Pane[] = [];
      for (let p = 0; p < pages; p++) {
        own.push({
          cls,
          judge: g.judge,
          surname,
          rows: g.rows.slice(p * perPage, (p + 1) * perPage),
          page: p + 1,
          pages,
          shownOf: shown < g.rows.length ? { shown, total: g.rows.length } : null,
        });
      }
      byCard.push(own);
    }
  });

  // **Every card's first page before any card's second.** Laid out card by
  // card instead, a screen of four panes was two classes shown twice — places
  // 1–5 beside places 6–9 of the same class — which is the opposite of the
  // point: somebody walks up to find out whether *their* class is up, and the
  // first screen should carry as many different classes as it holds.
  const panes: Pane[] = [];
  const deepest = byCard.reduce((m, own) => Math.max(m, own.length), 0);
  for (let p = 0; p < deepest; p++) {
    for (const own of byCard) {
      if (own[p]) panes.push(own[p]);
    }
  }

  return panes;
}

/** Packs panes into screenfuls, greedily and **in order** — newest-posted
 *  first, the order `postedToday` already put them in. */
function buildSlides(panes: Pane[], perScreen: number): Slide[] {
  const slides: Slide[] = [];
  for (let i = 0; i < panes.length; i += perScreen) {
    const chunk = panes.slice(i, i + perScreen);
    slides.push({
      panes: chunk,
      rows: chunk.reduce((n, p) => n + p.rows.length, 0),
    });
  }
  return slides;
}

/** How long a screen is held: longer when it carries more, and longer again
 *  the further away it is being read from.
 *
 *  A screen is up to four classes rather than one, so both the floor and the
 *  ceiling are higher than they were — there is four times as much to get
 *  through, and a board that turns over before anyone has found their class
 *  is one people stop looking at. Priced off every placing on the screen, not
 *  the tallest pane. */
function slideMs(rows: number, dwellFactor: number) {
  return Math.round(clamp((6000 + 450 * rows) * dwellFactor, 9000, 34000));
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
  const placed = r.place != null;
  return (
    <li className="flex items-center" style={{ gap: u(0.8), height: u(ROW_U) }}>
      <span
        className="flex-none rounded-full flex items-center justify-center font-bold tabular-nums"
        style={{
          width: u(2.7),
          height: u(2.7),
          fontSize: u(1.45),
          backgroundColor: placed ? PLACE_COLOR[r.place!] ?? 'var(--slate-raised)' : 'var(--slate-raised)',
          color: placed && r.place! <= 3 ? 'var(--brand-slate)' : 'var(--on-slate-muted)',
          border: placed ? 'none' : `${u(0.09)} solid var(--on-slate-muted)`,
        }}
      >
        {r.place ?? (outcomeShort(r.outcome) || '—')}
      </span>

      {/* Two lines rather than one. The old single line had to truncate, and
          the first thing to go was always the horse — on a results board the
          horse is half of who won. Splitting them also lets the exhibitor be
          set larger than the horse, which is the order a room reads them in. */}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline" style={{ gap: u(0.45) }}>
          {r.back_number != null && (
            <span
              className="flex-none font-semibold tabular-nums"
              style={{ fontSize: u(1.85), lineHeight: 1.05, color: 'var(--on-slate-muted)' }}
            >
              #{r.back_number}
            </span>
          )}
          <span
            className="truncate font-semibold"
            style={{ fontSize: u(1.85), lineHeight: 1.05, color: 'var(--on-slate)' }}
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
            style={{ fontSize: u(1.2), lineHeight: 1.15, color: 'var(--on-slate-muted)' }}
          >
            {r.horse_name}
          </span>
        )}
      </span>
    </li>
  );
}

/** One class's card in one cell of the grid. Carries its own name, because
 *  four of these share a screen and the screen can no longer be titled after
 *  whichever class is on it. */
function ClassPane({ pane }: { pane: Pane }) {
  const { cls, judge, surname, rows, page, pages, shownOf } = pane;
  const context = [cls.ring_name, cls.division_name, cls.discipline_name].filter(Boolean).join(' · ');

  return (
    <section
      className="flex flex-col min-h-0 min-w-0 overflow-hidden animate-[board-fade-in_0.4s_ease-out]"
      style={{
        backgroundColor: 'var(--slate-raised)',
        borderRadius: u(0.8),
        padding: `${u(0.7)} ${u(1)}`,
      }}
    >
      {/* Pinned height, so the arithmetic that decided how many rows fit below
          is exact rather than a guess at what two lines of class name measure
          out to. Same rule as ROW_U and JUDGE_HEAD_U. */}
      <header className="flex-none min-w-0 flex flex-col justify-center" style={{ height: c(CARD_HEAD_UC) }}>
        <div
          className="font-medium tracking-wide flex items-center min-w-0"
          style={{ fontSize: c(0.95), color: 'var(--on-slate-muted)', gap: c(0.5) }}
        >
          <span className="truncate">{context || 'Class results'}</span>
          {pages > 1 && (
            <span
              className="flex-none rounded-full tabular-nums"
              style={{
                fontSize: c(0.8),
                padding: `0 ${c(0.45)}`,
                backgroundColor: 'var(--slate)',
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
            // Two lines, then ellipsis. The name is the one thing in a pane
            // allowed to wrap: a clipped one leaves the room guessing which
            // class it is looking at, which is the whole point of the pane.
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          #{cls.class_number} · {cls.class_name}
        </h2>
      </header>

      {judge && (
        <div
          className="font-semibold truncate flex-none flex items-center"
          style={{ fontSize: u(1.15), height: u(JUDGE_HEAD_U), color: 'var(--accent-light)' }}
        >
          {/* The surname, as on the marquee. A quarter-width pane is mostly
              ellipsis if it is given "Judge Leigh Ann Skurupey". */}
          Judge {surname ?? judge}
        </div>
      )}

      {/* `safe center`, as the full-screen stage used: a short card sits in the
          middle of its cell rather than hanging off the top, and if a resize
          ever leaves the rows momentarily taller than the box the overflow
          falls off the bottom rather than cutting off first place. */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col" style={{ justifyContent: 'safe center' }}>
        {rows.length === 0 ? (
          <p style={{ fontSize: u(1.2), color: 'var(--on-slate-muted)' }}>No placings recorded.</p>
        ) : (
          <ul className="min-w-0">
            {rows.map((r, i) => (
              <PlacingRow key={i} r={r} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ScreenGrid({
  slide,
  shape,
  gridRef,
}: {
  slide: Slide;
  shape: { cols: number; rows: number };
  /** The grid area measures itself and reports back up, which is what decides
   *  how many rows the next build puts in a pane. Estimating it from font
   *  sizes was off by most of a row, and the row it was off by fell behind the
   *  ticker. */
  gridRef: (node: HTMLElement | null) => void;
}) {
  return (
    <div
      ref={gridRef}
      className="w-full h-full grid min-h-0"
      style={{
        gap: u(GRID_GAP_U),
        gridTemplateColumns: `repeat(${shape.cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${shape.rows}, minmax(0, 1fr))`,
      }}
    >
      {slide.panes.map((p) => (
        <ClassPane key={`${p.cls.id}:${p.judge ?? ''}:${p.page}`} pane={p} />
      ))}
      {/* Deliberately no filler for an under-full last screen: an empty cell
          is the honest shape of "that is everything posted today", where a
          pane stretched to cover it would imply the grid holds fewer classes
          than it does. */}
    </div>
  );
}

function Ticker({ items, ucPx }: { items: string[]; ucPx: number }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(40);
  const strip = items.join('      ★      ');

  useEffect(() => {
    const el = trackRef.current;
    if (!el || !ucPx) return;
    const oneCopyWidth = el.scrollWidth / 2;
    // Travel priced in units, not pixels, so the crawl covers the same angle
    // per second whatever the board is scaled to. A fixed px/sec reads as a
    // sprint on a desk monitor and a drift across a lobby.
    setDuration(Math.max(15, oneCopyWidth / Math.max(40, ucPx * TICKER_U_PER_SEC)));
  }, [strip, ucPx]);

  if (items.length === 0) return null;

  return (
    <div className="overflow-hidden w-full" style={{ backgroundColor: 'var(--slate-raised)' }}>
      <div
        ref={trackRef}
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
        <span style={{ paddingRight: c(6) }}>{strip}</span>
        <span style={{ paddingRight: c(6) }} aria-hidden="true">
          {strip}
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

/** Asked once per device, because nothing else can answer it. Worded as where
 *  the screen is and how far away the reader stands, not as a diagonal —
 *  nobody setting up a lobby TV knows whether it is 58" or 65", and the
 *  distance is what actually decides the layout. */
function SizePicker({ onPick }: { onPick: (k: SizeKey) => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center p-[4vh]">
      <div className="text-center" style={{ marginBottom: '4vh' }}>
        <h1 className="font-bold" style={{ fontSize: '4.2vh', color: 'var(--on-slate)' }}>
          Where is this screen?
        </h1>
        <p style={{ fontSize: '2vh', marginTop: '1vh', color: 'var(--on-slate-muted)' }}>
          A browser is never told how big its screen is, and a lobby TV needs letters several times
          taller than a desk monitor. Pick once — this device will remember.
        </p>
      </div>

      <div
        className="grid gap-[2vh] w-full"
        style={{ maxWidth: '150vh', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
      >
        {SIZE_ORDER.map((key, i) => {
          const p = PRESETS[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(key)}
              className="rounded-xl text-left transition hover:brightness-125"
              style={{
                padding: '3vh',
                backgroundColor: 'var(--slate-raised)',
                border: '0.2vh solid var(--on-slate-muted)',
                color: 'var(--on-slate)',
              }}
            >
              <div style={{ fontSize: '5vh' }} aria-hidden>
                {p.icon}
              </div>
              <div className="font-bold" style={{ fontSize: '2.8vh', marginTop: '1vh' }}>
                {p.label}
              </div>
              <div style={{ fontSize: '2vh', color: 'var(--accent-light)' }}>{p.inches}</div>
              <div style={{ fontSize: '1.8vh', marginTop: '0.6vh', color: 'var(--on-slate-muted)' }}>
                {p.distance}
              </div>
              <div style={{ fontSize: '1.7vh', marginTop: '1.4vh', color: 'var(--on-slate-muted)' }}>
                {p.blurb}
              </div>
              <div style={{ fontSize: '1.5vh', marginTop: '1.4vh', color: 'var(--on-slate-muted)' }}>
                Press {i + 1}
              </div>
            </button>
          );
        })}
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
}: {
  showId: string;
  show: ShowInfo;
  classes: ClassItem[];
  resultsIndex: Record<string, Placing[]>;
}) {
  const [now, setNow] = useState(() => new Date());
  const [slideIndex, setSlideIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  // Resolved on the client, so the board never renders at the wrong scale for
  // a frame — and so the ticker, which measures itself, never measures a size
  // it is about to stop being.
  const [size, setSize] = useState<SizeKey | null>(null);
  const [resolved, setResolved] = useState(false);

  const [vh, setVh] = useState(0);
  const [gridRef, gridBox] = useBoxSize();

  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();

  // Controls and cursor surface on movement and go away again, so the board
  // spends its life as a board rather than a web page with buttons on it.
  const [chrome, setChrome] = useState(false);
  const chromeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wake = useCallback(() => {
    setChrome(true);
    if (chromeTimer.current) clearTimeout(chromeTimer.current);
    chromeTimer.current = setTimeout(() => setChrome(false), 3000);
  }, []);

  const choose = useCallback((k: SizeKey) => {
    setSize(k);
    try {
      window.localStorage.setItem(STORAGE_KEY, k);
    } catch {
      // Private window, or storage refused. The board still works; it will
      // just ask again next time it is opened on this device.
    }
  }, []);

  useEffect(() => {
    // `?size=hall` wins and is remembered, so the office can bookmark one link
    // per screen and never meet the picker on that device again.
    let initial: SizeKey | null = null;
    try {
      const param = new URLSearchParams(window.location.search).get('size');
      if (param && param in PRESETS) initial = param as SizeKey;
    } catch {
      /* ignore */
    }
    if (!initial) {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored && stored in PRESETS) initial = stored as SizeKey;
      } catch {
        /* ignore */
      }
    }
    if (initial) choose(initial);
    setResolved(true);
  }, [choose]);

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

  // A class's placings split by judge, computed once: the grid shape is
  // derived from how many of these there are, and the panes are built from
  // the same list.
  const groups = useMemo(
    () => postedToday.map((cls) => groupByJudge(resultsIndex[cls.id] ?? [])),
    [postedToday, resultsIndex],
  );
  const groupCount = useMemo(() => groups.reduce((n, g) => n + g.length, 0), [groups]);

  // How the screen divides, and how many panes it therefore holds. Taken from
  // the *group* count rather than the pane count, which is what breaks the
  // circularity: paging depends on how tall a cell is, a cell's height depends
  // on the grid, and the grid must not reshape itself between screens.
  const shape = useMemo(() => gridShape(groupCount), [groupCount]);
  const perScreen = Math.min(CLASSES_PER_SCREEN, shape.cols * shape.rows);

  // What fits in one cell, taken from the grid area the browser actually
  // handed us rather than from a breakpoint or a guess at type metrics. The
  // same arithmetic covers every panel in the range, the 4K ones and the odd
  // 21:9 included.
  const { rowsPlain, rowsJudged } = useMemo(() => {
    if (!uPx || !gridBox.h) return { rowsPlain: 3, rowsJudged: 3 };
    const rowPx = ROW_U * uPx;
    // The gaps between grid rows come out of the height before it is divided.
    const cellH = (gridBox.h - GRID_GAP_U * uPx * (shape.rows - 1)) / shape.rows;
    // Three things come off a cell before the placings do, and they are not
    // all in the same unit: the pane's padding and the judge's name scale with
    // the results, its header with the chrome. Leaving the padding out was
    // half a row of overcount, and half a row is exactly what gets sliced
    // through the middle at the bottom of the cell.
    const fit = (judged: boolean) =>
      clamp(
        Math.floor(
          (cellH - PANE_PAD_U * uPx - CARD_HEAD_UC * ucPx - (judged ? JUDGE_HEAD_U * uPx : 0)) /
            rowPx,
        ),
        1,
        24,
      );
    return { rowsPlain: fit(false), rowsJudged: fit(true) };
  }, [uPx, ucPx, gridBox.h, shape.rows]);

  const slides = useMemo(() => {
    const panes = buildPanes(postedToday, groups, rowsPlain, rowsJudged, perScreen);
    return buildSlides(panes, perScreen);
  }, [postedToday, groups, rowsPlain, rowsJudged, perScreen]);

  const active = slides.length ? slides[slideIndex % slides.length] : null;
  const dwellMs = active ? slideMs(active.rows, preset.dwell) : 0;

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
      wake();
      if (e.key >= '1' && e.key <= '3') {
        choose(SIZE_ORDER[Number(e.key) - 1]);
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
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
  }, [choose, step, wake, toggleFullscreen]);

  const tickerItems = useMemo(() => {
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
        const placed = g.rows.filter((r) => r.place != null).slice(0, 3);
        const summary = placed.map((r) => `${placeOrdinal(r.place!)} ${rowLabel(r)}`).join('  ·  ');
        const surname = judgeSurname(g.rows);
        items.push(`${head}${surname ? ` · Judge ${surname}` : ''}: ${summary || 'no placings yet'}`);
      }
    });
    return items;
  }, [postedToday, groups]);

  const btn = {
    fontSize: c(0.85),
    padding: `${c(0.25)} ${c(0.6)}`,
    color: 'var(--on-slate-muted)',
  } as const;

  return (
    <div
      className="fixed inset-0 z-50"
      style={{ backgroundColor: 'var(--slate)', cursor: chrome ? 'auto' : 'none' }}
      onMouseMove={wake}
    >
      {!resolved ? null : size === null ? (
        <SizePicker onPick={choose} />
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
            style={{ paddingInline: c(1.8), paddingTop: c(0.6), paddingBottom: c(0.7) }}
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
                style={{ fontSize: c(1.25), marginLeft: c(0.4), color: 'var(--on-slate-muted)' }}
              >
                {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
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
                key={slideIndex}
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
            style={{ paddingInline: c(1.8), paddingTop: c(0.5), paddingBottom: c(0.5) }}
          >
            {active ? (
              <ScreenGrid key={slideIndex} slide={active} shape={shape} gridRef={gridRef} />
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
                  Posted placings will start rotating through here as soon as the first class of the
                  day goes up.
                </p>
              </div>
            )}
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
            {SIZE_ORDER.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => choose(k)}
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
