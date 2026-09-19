'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

/* Layout constants, in units of --u. ROW_U and JUDGE_HEAD_U are pinned as
   explicit heights on the elements themselves, so the arithmetic deciding what
   fits is exact rather than a guess at what the type will measure out to. */
const ROW_U = 3.7; // a placing row: badge, name, horse, and the gap under it
const JUDGE_HEAD_U = 2.4; // "Judge Delgado" and its margin
const MIN_COL_U = 30; // the narrowest a judge column is allowed to get
const FLOW_MIN_U = 26; // ...and the narrowest a plain placings column may get
const TICKER_U_PER_SEC = 4.5; // ticker travel per second, in units, so the
// crawl reads at one speed to the eye at every scale

/* Roughly two minutes of rotation. A morning with three classes posted can
   afford to page all the way down each one; an evening with thirty cannot, or
   somebody waiting on their class waits a quarter of an hour for it to come
   round again. This is the budget of screens divided between them. */
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

/* ── Slides ────────────────────────────────────────────────────────────────
   The rotation is a flat list of screens rather than a list of classes. A
   class with more placings than fit becomes two screens instead of being cut
   off at "+7 more", and a panel-judged class whose judges will not fit side by
   side becomes one screen per judge.

   What it will not do is let one class own the rotation. Every class gets a
   share of CYCLE_SLIDES; when its placings need more screens than its share,
   the ones that are shown say so — "top 4 of 12" — rather than trailing off
   and leaving the room to wonder whether that was the whole card.
   ────────────────────────────────────────────────────────────────────────── */

type Slide = {
  cls: ClassItem;
  groups: JudgeGroup[];
  page: number;
  pages: number;
  /** Set when this class is showing less than its full card. */
  shownOf: { shown: number; total: number } | null;
  /** Tallest column on this screen, which is what its dwell is priced from. */
  rows: number;
};

function buildSlides(
  classes: ClassItem[],
  resultsIndex: Record<string, Placing[]>,
  rowsSingle: number,
  rowsPanel: number,
  cols: number,
  flowCols: number,
): Slide[] {
  const slides: Slide[] = [];
  const budget = clamp(Math.round(CYCLE_SLIDES / Math.max(classes.length, 1)), 1, 4);

  for (const cls of classes) {
    const groups = groupByJudge(resultsIndex[cls.id] ?? []);

    if (groups.length === 1) {
      const all = groups[0].rows;
      // One judge, so the width that a panel class spends on a second judge is
      // spare. A card deeper than one column flows into two, newspaper-style,
      // rather than leaving half a 75" screen dark and paging twice as often.
      const flow = all.length > rowsSingle ? flowCols : 1;
      const perPage = rowsSingle * flow;
      const pages = clamp(Math.ceil(all.length / perPage), 1, budget);
      const shown = Math.min(all.length, pages * perPage);
      for (let p = 0; p < pages; p++) {
        const chunk = all.slice(p * perPage, (p + 1) * perPage);
        // Split evenly rather than filling the first column and letting the
        // overflow trail into the second: eleven names beside a lonely twelfth
        // reads as a rendering fault, not as a second column.
        const perColumn = Math.ceil(chunk.length / flow);
        const columns: JudgeGroup[] = [];
        for (let k = 0; k < flow; k++) {
          const rows = chunk.slice(k * perColumn, (k + 1) * perColumn);
          if (rows.length) columns.push({ judge: null, rows, total: all.length });
        }
        slides.push({
          cls,
          groups: columns.length ? columns : [{ judge: null, rows: [], total: 0 }],
          page: p + 1,
          pages,
          shownOf: shown < all.length ? { shown, total: all.length } : null,
          rows: columns.reduce((max, g) => Math.max(max, g.rows.length), 0),
        });
      }
      continue;
    }

    // Panel-judged. Judges sit side by side while there is width for them, and
    // one screen at a time once there is not — two columns squeezed onto a
    // lobby TV is how horse names ended up as "Certainly Good Lo…". Every judge
    // always gets a screen; extra placings get extra screens only if the budget
    // runs to it, because a card nobody saw beats a judge nobody saw.
    const judgePages = Math.ceil(groups.length / cols);
    const deepest = groups.reduce((m, g) => Math.max(m, g.rows.length), 0);
    const rowPages = clamp(Math.floor(budget / judgePages), 1, Math.ceil(deepest / rowsPanel));
    const shown = Math.min(deepest, rowPages * rowsPanel);

    for (let jp = 0; jp < judgePages; jp++) {
      const cohort = groups.slice(jp * cols, (jp + 1) * cols);
      for (let rp = 0; rp < rowPages; rp++) {
        const slice = cohort.map((g) => ({
          judge: g.judge,
          rows: g.rows.slice(rp * rowsPanel, (rp + 1) * rowsPanel),
          total: g.total,
        }));
        slides.push({
          cls,
          groups: slice,
          page: jp * rowPages + rp + 1,
          pages: judgePages * rowPages,
          shownOf: shown < deepest ? { shown, total: deepest } : null,
          rows: slice.reduce((max, g) => Math.max(max, g.rows.length), 0),
        });
      }
    }
  }

  return slides;
}

/** How long a screen is held: longer when it carries more, and longer again
 *  the further away it is being read from. */
function slideMs(rows: number, dwellFactor: number) {
  return Math.round(clamp((5500 + 750 * rows) * dwellFactor, 6000, 22000));
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

function ClassStage({
  slide,
  listRef,
}: {
  slide: Slide;
  /** The list area measures itself and reports back up, which is what decides
   *  how many rows the next build puts on a screen. Estimating it from font
   *  sizes was off by most of a row, and the row it was off by fell behind the
   *  ticker. */
  listRef: (node: HTMLElement | null) => void;
}) {
  const { cls, groups, page, pages, shownOf } = slide;
  const context = [cls.ring_name, cls.division_name, cls.discipline_name].filter(Boolean).join(' · ');
  const empty = groups.every((g) => g.rows.length === 0);

  return (
    <div className="w-full h-full flex flex-col animate-[board-fade-in_0.4s_ease-out]">
      <div style={{ marginBottom: u(0.7) }}>
        <div
          className="font-medium tracking-wide flex items-center min-w-0"
          style={{ fontSize: c(1.25), color: 'var(--on-slate-muted)', gap: c(0.7) }}
        >
          <span className="truncate">{context || 'Class Results'}</span>
          {pages > 1 && (
            <span
              className="flex-none rounded-full tabular-nums"
              style={{
                fontSize: c(0.95),
                padding: `${c(0.1)} ${c(0.6)}`,
                backgroundColor: 'var(--slate-raised)',
                color: 'var(--on-slate-muted)',
              }}
            >
              {page} / {pages}
            </span>
          )}
          {shownOf && (
            <span className="flex-none" style={{ fontSize: c(0.95) }}>
              top {shownOf.shown} of {shownOf.total}
            </span>
          )}
        </div>
        <h1
          className="font-bold"
          style={{
            fontSize: u(2.6),
            lineHeight: 1.04,
            marginTop: u(0.15),
            color: 'var(--on-slate)',
            // Two lines of class name, then ellipsis. The title is the one
            // thing here allowed to wrap: it is read once, at the top, and a
            // clipped one leaves the room guessing which class this is.
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          #{cls.class_number} · {cls.class_name}
        </h1>
      </div>

      {/* `safe center` rather than plain centring: a class shorter than the
          screen sits in the middle of it instead of hanging off the top, but
          if a resize ever leaves the rows momentarily taller than the box, the
          overflow falls off the bottom rather than cutting off first place. */}
      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-hidden flex flex-col"
        style={{ justifyContent: 'safe center' }}
      >
        {empty ? (
          <p style={{ fontSize: u(1.8), color: 'var(--on-slate-muted)' }}>No placings recorded.</p>
        ) : (
          <div
            className="grid"
            style={{ gap: u(2.5), gridTemplateColumns: `repeat(${groups.length}, minmax(0, 1fr))` }}
          >
            {groups.map((g, gi) => (
              <div key={g.judge ?? `col-${gi}`} className="flex flex-col min-w-0">
                {g.judge && (
                  <div
                    className="font-semibold truncate flex-none flex items-center"
                    style={{ fontSize: u(1.35), height: u(JUDGE_HEAD_U), color: 'var(--accent-light)' }}
                  >
                    Judge {g.judge}
                  </div>
                )}
                <ul className="min-w-0">
                  {g.rows.map((r, i) => (
                    <PlacingRow key={i} r={r} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
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
  const [listRef, listBox] = useBoxSize();

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

  // What fits, taken from the list area the browser actually handed us rather
  // than from a breakpoint or a guess at type metrics. The same arithmetic
  // covers every panel in the range, the 4K ones and the odd 21:9 included.
  const { rowsSingle, rowsPanel, cols, flowCols } = useMemo(() => {
    if (!uPx || !listBox.h) return { rowsSingle: 4, rowsPanel: 4, cols: 1, flowCols: 1 };
    const rowPx = ROW_U * uPx;
    const widthU = listBox.w / uPx;
    return {
      rowsSingle: clamp(Math.floor(listBox.h / rowPx), 1, 24),
      rowsPanel: clamp(Math.floor((listBox.h - JUDGE_HEAD_U * uPx) / rowPx), 1, 24),
      cols: clamp(Math.floor(widthU / MIN_COL_U), 1, 3),
      flowCols: clamp(Math.floor(widthU / FLOW_MIN_U), 1, 2),
    };
  }, [uPx, listBox.h, listBox.w]);

  const slides = useMemo(
    () => buildSlides(postedToday, resultsIndex, rowsSingle, rowsPanel, cols, flowCols),
    [postedToday, resultsIndex, rowsSingle, rowsPanel, cols, flowCols],
  );

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
  }, [choose, step, wake]);

  const tickerItems = useMemo(
    () =>
      postedToday.map((cls) => {
        const rows = (resultsIndex[cls.id] ?? []).filter((r) => r.place != null).slice(0, 3);
        const summary = rows.map((r) => `${placeOrdinal(r.place!)} ${rowLabel(r)}`).join('  ·  ');
        return `#${cls.class_number} ${cls.class_name}: ${summary || 'no placings yet'}`;
      }),
    [postedToday, resultsIndex],
  );

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
                it up. */}
            <Link
              href={`/admin/shows/${showId}`}
              className="opacity-30 hover:opacity-80 transition flex-none"
              style={{ fontSize: c(1), color: 'var(--on-slate)' }}
            >
              GaitDesk
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
                key={`${active.cls.id}:${active.page}:${slideIndex}`}
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
              <ClassStage key={`${active.cls.id}:${active.page}`} slide={active} listRef={listRef} />
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
