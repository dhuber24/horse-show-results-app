'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  boardRings,
  gateLane,
  localToday,
  numbersOrderOfGo,
  riderTally,
  type BoardClass,
  type BoardRider,
  type BoardRing,
  type GateLane,
} from '@/lib/gate-board';
import { BoardCanvas, BoardControls, BoardHeader, BoardNotice, BoardRoot, FillPrompt } from '../_components/BoardChrome';
import { BoardSetupPage, HubHeading, ScreenPicker, segmentStyle } from '../_components/BoardSetup';
import { useBoxSize } from '../_components/hooks';
import { U_VH, c, u, wrap, type SizeKey } from '../_components/units';
import { useBoardScreen } from '../_components/useBoardScreen';

/* ── The gate board ──────────────────────────────────────────────────────────
   For the riders who are not in the ring yet: one ring's gate, on a TV by the
   in-gate or the warm-up pen. Top to bottom —

     In the ring   one line: the class (or classes run together) in the ring
                   now. No riders: they are already in.
     On deck       the next class, its riders in their order of go, each with
     In the hole   a ✓ once the gate has them checked in — side by side with
                   the class after it, the same way.
     Coming up     the few classes after those, a line each.

   The point of the ✓ is the blank beside it: a rider who reads their number
   with nothing beside it knows to go and report to the gate.

   **One ring to a board.** A gate TV sits at one ring's gate, so a show
   running two rings puts up two boards; the board's page asks which ring
   (`?ring=`) when the show has more than one, and carries it in the URL with
   the size, for the same reasons.

   **It follows the gate steward and nothing else** (`lib/gate-board.ts`): in
   the ring is what the gate started, on deck the first class it has not —
   the steward's own rule. Posted results do not move it.

   **It polls the gate itself**, every ten seconds, rather than re-rendering
   the page: which classes are on deck depends on the day, the day is the
   reader's own (a server renders in UTC), and the riders are fetched for
   just those two classes. The gate's own endpoints serve it — the show office
   who put the board up may read the gate — so nothing new is exposed.
   ────────────────────────────────────────────────────────────────────────── */

/** Named, so opening the board a second time reuses its window rather than
 *  stacking another one onto the TV — and not the results boards' name, so
 *  each can have a monitor of its own. */
const BOARD_WINDOW = 'gaitdesk-gate-board';

/** A check-in at the gate reaches the board within this. The same interval
 *  the steward's own screen polls on. */
const POLL_MS = 10_000;

/** How long a page of riders stays up when a class has more than fit, before
 *  the multiplier for reading at a distance. */
const PAGE_MS = 8_000;

/* Layout, in --u. Pinned as explicit heights, so the arithmetic deciding how
   many riders fit is exact rather than a guess at what the type measures. */
const ROW_U = 2.5; // one rider: number, back number, name and horse, the mark
const PANE_HEAD_U = 4.4; // the section label and the class's name over it
const PANE_PAD_U = 1.4; // a pane's own top and bottom padding, together
/* The narrowest a column of riders gets. Below it the exhibitor's name is cut
   to a dozen letters beside the back number, so a pane goes to a second
   column only where each can be this wide. */
const MIN_COL_U = 24;
const COL_GAP_U = 2;
/* How far the riders are drawn below the preset's size so that a class fits
   on one page, before the board pages through it instead: a rider is better
   read on the second page than not read at all on the first. */
const FIT_SCALES = [1, 0.9, 0.8, 0.75];

type Fit = { scale: number; cols: number; rows: number; perPage: number; pages: number };

/** How a class's riders are laid out in a pane `w` x `h` px: the largest
 *  scale at which all of them fit, or failing that full size a page at a
 *  time.
 *
 *  **Down the pane to the bottom before a second column**: `rows` is always
 *  as many as the pane holds, never the riders split evenly between two
 *  columns, and a class that fits in one column gets one, the pane's full
 *  width — a second column half empty only took width from the names. */
function fitRiders(n: number, w: number, h: number, uPx: number): Fit {
  if (!uPx || !w || !h || n === 0) return { scale: 1, cols: 1, rows: Math.max(n, 1), perPage: Math.max(n, 1), pages: 1 };
  const layout = (s: number) => ({
    cols: w >= (2 * MIN_COL_U + COL_GAP_U) * uPx * s ? 2 : 1,
    rows: Math.max(1, Math.floor(h / (ROW_U * uPx * s))),
  });
  for (const s of FIT_SCALES) {
    const { cols, rows } = layout(s);
    if (rows >= n) return { scale: s, cols: 1, rows, perPage: n, pages: 1 };
    if (cols * rows >= n) return { scale: s, cols, rows, perPage: n, pages: 1 };
  }
  const { cols, rows } = layout(1);
  return { scale: 1, cols, rows, perPage: cols * rows, pages: Math.ceil(n / (cols * rows)) };
}

const PANE_STYLE = {
  backgroundColor: 'var(--slate-raised)',
  borderRadius: u(0.8),
} as const;

const LABEL = {
  fontSize: u(0.95),
  letterSpacing: '0.08em',
} as const;

function dayLabel(date: string, today: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(y, m - 1, d);
  // A board put up the evening before shows the morning's classes, and says
  // which morning.
  return day.toLocaleDateString(
    'en-US',
    date === today ? { weekday: 'long' } : { weekday: 'long', month: 'short', day: 'numeric' },
  );
}

const classLabel = (cls: BoardClass) => `#${cls.class_number} · ${cls.class_name}`;

/** The classes whose riders the board shows: on deck and in the hole. */
function calledIds(lane: GateLane | null): string[] {
  return [lane?.onDeck, lane?.inTheHole].filter((x): x is BoardClass => x != null).map((x) => x.id);
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

/** The one line about the ring itself: what is in it, and nothing about who —
 *  the riders in the ring are not the ones reading the board. */
function InRingBanner({ lane }: { lane: GateLane }) {
  const live = lane.inRing.length > 0;
  return (
    <section
      className="flex-none flex items-center min-w-0"
      style={{ ...PANE_STYLE, height: u(3), paddingInline: u(1.2), gap: u(1.2) }}
    >
      <span className="flex-none flex items-center font-bold uppercase" style={{ ...LABEL, gap: u(0.5), color: 'var(--on-slate-success)' }}>
        <span className="relative flex" style={{ width: u(0.6), height: u(0.6) }}>
          {live && (
            <span
              className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
              style={{ backgroundColor: 'var(--on-slate-success)' }}
            />
          )}
          <span
            className="relative inline-flex rounded-full h-full w-full"
            style={{ backgroundColor: live ? 'var(--on-slate-success)' : 'var(--on-slate-muted)' }}
          />
        </span>
        In the ring
      </span>
      {live ? (
        <span className="min-w-0 truncate font-semibold" style={{ fontSize: u(1.5), color: 'var(--on-slate)' }}>
          {/* Classes run together are one go, so they share the line. */}
          {lane.inRing.map(classLabel).join('  &  ')}
        </span>
      ) : (
        <span className="min-w-0 truncate" style={{ fontSize: u(1.35), color: 'var(--on-slate-muted)' }}>
          {lane.underway ? 'Between classes' : 'Nothing has gone in yet'}
        </span>
      )}
    </section>
  );
}

/** Beside a rider: ✓ once checked in, "No show" once called for and gone, and
 *  nothing while the gate is still waiting on them — the blank is the message. */
function RiderMark({ r }: { r: BoardRider }) {
  if (r.gate_no_show) {
    return (
      <span
        className="flex-none font-semibold uppercase whitespace-nowrap text-right"
        style={{ minWidth: u(2.4), fontSize: u(0.85), letterSpacing: '0.06em', color: 'var(--on-slate-muted)' }}
      >
        No show
      </span>
    );
  }
  return (
    <span
      className="flex-none font-bold text-center"
      style={{ width: u(2.4), fontSize: u(1.7), lineHeight: 1, color: 'var(--on-slate-success)' }}
      aria-label={r.gate_checked_in ? 'Checked in' : 'Not checked in yet'}
    >
      {r.gate_checked_in ? '✓' : ''}
    </span>
  );
}

function RiderRow({ r, n, numbered }: { r: BoardRider; n: number; numbered: boolean }) {
  return (
    <li
      className="flex items-center min-w-0"
      style={{ height: u(ROW_U), gap: u(0.8), opacity: r.gate_no_show ? 0.5 : 1 }}
    >
      {numbered && (
        <span
          className="flex-none text-right tabular-nums"
          style={{ width: u(1.8), fontSize: u(1.15), color: 'var(--on-slate-muted)' }}
        >
          {n}
        </span>
      )}
      {/* The back number first and largest: it is what a rider looks for, and
          what the steward calls. */}
      <span
        className="flex-none font-bold tabular-nums"
        style={{ minWidth: u(4.4), fontSize: u(1.6), lineHeight: 1.1, color: 'var(--on-slate)' }}
      >
        {r.back_number != null ? `#${r.back_number}` : '—'}
      </span>
      {/* One line, the horse after the rider and smaller: when it is cut
          short, it is the horse that goes, not who is riding it. */}
      <span
        className="min-w-0 flex-1 truncate"
        style={{
          lineHeight: 1.15,
          // The ellipsis is drawn in this span's own type, and it is the
          // horse's name it ends — at the page's 16px it all but vanished.
          fontSize: u(1.15),
          color: 'var(--on-slate-muted)',
          textDecoration: r.gate_no_show ? 'line-through' : undefined,
        }}
      >
        <span className="font-semibold" style={{ fontSize: u(1.5), color: 'var(--on-slate)' }}>
          {r.exhibitor_name}
        </span>
        {r.horse_name && (
          <span style={{ fontSize: u(1.15), color: 'var(--on-slate-muted)' }}>
            {'  ·  '}
            {r.horse_name}
          </span>
        )}
      </span>
      <RiderMark r={r} />
    </li>
  );
}

type PaneKind = 'deck' | 'hole';

function PaneLabel({ kind }: { kind: PaneKind }) {
  // On deck is the one being called, so it is filled in; in the hole is
  // outlined, a step behind it.
  return kind === 'deck' ? (
    <span
      className="flex-none rounded-full font-bold uppercase whitespace-nowrap"
      style={{
        ...LABEL,
        padding: `${u(0.2)} ${u(0.8)}`,
        backgroundColor: 'var(--accent-light)',
        color: 'var(--brand-slate)',
      }}
    >
      On deck
    </span>
  ) : (
    <span
      className="flex-none rounded-full font-bold uppercase whitespace-nowrap"
      style={{
        ...LABEL,
        padding: `${u(0.2)} ${u(0.8)}`,
        boxShadow: `inset 0 0 0 ${u(0.12)} var(--on-slate-muted)`,
        color: 'var(--on-slate)',
      }}
    >
      In the hole
    </span>
  );
}

/** A class called to the gate — on deck or in the hole — and its riders in
 *  their order of go, each marked once checked in. Measures itself, so how
 *  many riders a page holds comes from the space the browser actually gave
 *  it rather than a guess at the type. */
function OrderPane({
  kind,
  cls,
  riders,
  uPx,
  unitVh,
  tick,
}: {
  kind: PaneKind;
  cls: BoardClass;
  /** Undefined until the first answer for this class arrives. */
  riders: BoardRider[] | undefined;
  uPx: number;
  unitVh: number;
  tick: number;
}) {
  const [listRef, box] = useBoxSize();
  const list = riders ?? [];
  const fit = fitRiders(list.length, box.w, box.h, uPx);
  const page = wrap(tick, fit.pages);
  const shown = list.slice(page * fit.perPage, (page + 1) * fit.perPage);
  const numbered = numbersOrderOfGo(cls, list);
  const tally = riderTally(list);
  // Out of the riders still expected: a no-show is not coming.
  const expected = tally.riders - tally.noShow;
  const allIn = expected > 0 && tally.checkedIn === expected;

  return (
    <section
      className="flex flex-col min-h-0 min-w-0 overflow-hidden animate-[board-fade-in_0.4s_ease-out]"
      style={{ ...PANE_STYLE, padding: `${u(PANE_PAD_U / 2)} ${u(1)}` }}
    >
      <header className="flex-none flex flex-col justify-center min-w-0" style={{ height: u(PANE_HEAD_U) }}>
        <div className="flex items-center min-w-0" style={{ gap: u(0.8) }}>
          <PaneLabel kind={kind} />
          {/* Which page of the class this is, as dots: a rider who is not on
              this page needs to know another is coming, and "5–8 of 8" beside
              the count pushed it off the pane at the lobby size. */}
          {fit.pages > 1 && (
            <span
              className="flex-none flex items-center"
              style={{ gap: u(0.4) }}
              role="img"
              aria-label={`Page ${page + 1} of ${fit.pages}`}
            >
              {Array.from({ length: fit.pages }, (_, i) => (
                <span
                  key={i}
                  className="rounded-full"
                  style={{
                    width: u(0.6),
                    height: u(0.6),
                    backgroundColor: i === page ? 'var(--on-slate)' : 'var(--on-slate-muted)',
                    opacity: i === page ? 1 : 0.4,
                  }}
                />
              ))}
            </span>
          )}
          <span className="flex-1" />
          {riders && expected > 0 && (
            <span
              className="min-w-0 truncate font-semibold tabular-nums"
              style={{ fontSize: u(1.1), color: allIn ? 'var(--on-slate-success)' : 'var(--on-slate-muted)' }}
            >
              {allIn ? `✓ All ${expected} checked in` : `${tally.checkedIn} of ${expected} checked in`}
            </span>
          )}
        </div>
        <h2
          className="font-bold truncate"
          style={{ fontSize: u(1.75), lineHeight: 1.15, marginTop: u(0.45), color: 'var(--on-slate)' }}
        >
          {classLabel(cls)}
        </h2>
      </header>

      <div ref={listRef} className="flex-1 min-h-0 overflow-hidden">
        {!riders ? (
          // Said rather than left blank, so a board just put up does not read
          // as a class with nobody in it while the first answer is on its way.
          <p style={{ fontSize: u(1.2), marginTop: u(0.6), color: 'var(--on-slate-muted)' }}>Loading the riders…</p>
        ) : list.length === 0 ? (
          <p style={{ fontSize: u(1.3), marginTop: u(0.6), color: 'var(--on-slate-muted)' }}>No riders entered.</p>
        ) : (
          <ol
            // Keyed on the page, so a turn fades in like a results screen.
            key={page}
            className="grid animate-[board-fade-in_0.4s_ease-out]"
            style={
              {
                // The riders' own unit, drawn smaller where that is what fits
                // the whole class on one page (`fitRiders`).
                '--u': `${(unitVh * fit.scale).toFixed(3)}vh`,
                gridTemplateColumns: `repeat(${fit.cols}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${fit.rows}, ${u(ROW_U)})`,
                // Down the first column, then the second, the way an order of
                // go is read.
                gridAutoFlow: 'column',
                columnGap: u(COL_GAP_U),
              } as React.CSSProperties
            }
          >
            {shown.map((r, i) => (
              <RiderRow key={r.id} r={r} n={page * fit.perPage + i + 1} numbered={numbered} />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

/** A pane with nothing to call into it. */
function EmptyPane({ kind, children }: { kind: PaneKind; children: React.ReactNode }) {
  return (
    <section className="flex flex-col min-h-0 min-w-0" style={{ ...PANE_STYLE, padding: `${u(PANE_PAD_U / 2)} ${u(1)}` }}>
      <header className="flex-none flex items-center" style={{ height: u(PANE_HEAD_U) }}>
        <PaneLabel kind={kind} />
      </header>
      <p className="flex-1 flex items-center justify-center text-center" style={{ fontSize: u(1.4), color: 'var(--on-slate-muted)' }}>
        {children}
      </p>
    </section>
  );
}

/* The coming-up strip, in --u: what its label and "+3 more" take, and the
   narrowest a class gets in it — about "#114 Amateur Ranch Rid…". */
const COMING_UP_CHROME_U = 12;
const COMING_UP_ITEM_U = 17;

/** The classes after the one in the hole, a line each — enough to know your
 *  class is getting close, without anybody's riders. As many as fit across. */
function ComingUp({ classes, later, stageU }: { classes: BoardClass[]; later: number; stageU: number }) {
  const room =
    stageU > 0 ? Math.max(1, Math.floor((stageU - COMING_UP_CHROME_U) / COMING_UP_ITEM_U)) : classes.length;
  const shown = classes.slice(0, room);
  const more = later + (classes.length - shown.length);
  if (shown.length === 0) return null;
  return (
    <section
      className="flex-none flex items-center min-w-0"
      style={{ height: u(2.8), paddingInline: u(1.2), gap: u(1.4), borderTop: `${u(0.08)} solid var(--slate-raised)` }}
    >
      <span className="flex-none font-bold uppercase" style={{ ...LABEL, color: 'var(--on-slate-muted)' }}>
        Coming up
      </span>
      <div
        className="flex-1 min-w-0 grid"
        style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))`, columnGap: u(1.6) }}
      >
        {shown.map((cls) => (
          <div key={cls.id} className="min-w-0 truncate" style={{ fontSize: u(1.2), color: 'var(--on-slate)' }}>
            <span className="font-bold tabular-nums">#{cls.class_number}</span> {cls.class_name}
          </div>
        ))}
      </div>
      {more > 0 && (
        <span className="flex-none whitespace-nowrap" style={{ fontSize: u(1.05), color: 'var(--on-slate-muted)' }}>
          +{more} more
        </span>
      )}
    </section>
  );
}

/* ── The board's page ───────────────────────────────────────────────────── */

/** Which ring, then where the screen is. The sizes stay greyed out until a
 *  ring is chosen at a show with more than one. */
function GateBoardSetup({
  showId,
  showName,
  rings,
  ring,
  loadError,
  initialDuplicate,
  onRing,
  onPick,
}: {
  showId: string;
  showName: string;
  rings: BoardRing[];
  ring: string | null;
  loadError: string | null;
  initialDuplicate: boolean;
  onRing: (key: string) => void;
  onPick: (k: SizeKey, duplicate: boolean) => void;
}) {
  const blocked = loadError
    ? 'The classes could not be loaded'
    : rings.length === 0
      ? 'This show has no classes to call yet'
      : ring === null
        ? 'Choose the ring first'
        : null;

  return (
    <BoardSetupPage showId={showId} showName={showName} title="Gate Board" notice={loadError}>
      {rings.length > 1 && (
        <section>
          <HubHeading
            title="Which ring’s gate?"
            note="A gate board follows one ring. At a show running two rings, put a board up at each gate."
          />
          <div role="radiogroup" aria-label="Which ring the board follows" className="flex flex-wrap" style={{ gap: '1vh' }}>
            {rings.map((r) => (
              <button
                key={r.key}
                type="button"
                role="radio"
                aria-checked={ring === r.key}
                onClick={() => onRing(r.key)}
                className="rounded-lg font-semibold"
                style={segmentStyle(ring === r.key)}
              >
                {r.name ?? 'No ring set'}
              </button>
            ))}
          </div>
        </section>
      )}

      <ScreenPicker windowName={BOARD_WINDOW} initialDuplicate={initialDuplicate} onPick={onPick} blocked={blocked} />
    </BoardSetupPage>
  );
}

/* ── The board ──────────────────────────────────────────────────────────── */

type ShowInfo = { name: string; venue?: string | null };

export default function GateBoard({
  showId,
  show,
  initialClasses,
  loadError,
}: {
  showId: string;
  show: ShowInfo;
  /** The gate's class list as the page loaded it; the board polls it after. */
  initialClasses: BoardClass[];
  /** Why the classes could not be loaded, when they could not. */
  loadError: string | null;
}) {
  const [classes, setClasses] = useState<BoardClass[]>(initialClasses);
  const rings = useMemo(() => boardRings(classes), [classes]);

  // One ring, and there is nothing to ask. More, and the URL says which — a
  // ring no longer on the show is no answer, and the page asks again.
  const searchParams = useSearchParams();
  const ringParam = searchParams.get('ring');
  const ring = rings.length === 1 ? rings[0].key : (rings.find((r) => r.key === ringParam)?.key ?? null);
  const ringName = rings.find((r) => r.key === ring)?.name ?? null;

  const { mounted, size, duplicate, preset, uPx, fullscreen, fill, keepWindowed, chrome, wake, setQuery, choose, start, toSettings } =
    useBoardScreen({ noun: 'the gate board', canStart: ring !== null && !loadError });
  const running = size !== null && ring !== null;

  // The day is the reader's: set in the browser, and again on every poll, so
  // a board left up overnight turns to the next morning on its own.
  const [today, setToday] = useState('');
  useEffect(() => {
    setToday(localToday());
  }, []);

  const [riders, setRiders] = useState<Record<string, BoardRider[]>>({});
  const [offline, setOffline] = useState(false);

  // The list the last poll read, for the next poll to start from.
  const classesRef = useRef(classes);
  useEffect(() => {
    classesRef.current = classes;
  }, [classes]);

  const refresh = useCallback(async () => {
    if (ring === null) return;
    const day = localToday();
    setToday(day);
    const fetchRiders = async (id: string): Promise<BoardRider[] | null> => {
      try {
        const r = await fetch(`/api/shows/${showId}/gate/classes/${id}/entries`, { cache: 'no-store' });
        const body = await r.json().catch(() => null);
        return r.ok && Array.isArray(body) ? (body as BoardRider[]) : null;
      } catch {
        return null;
      }
    };
    try {
      // The riders of the classes on the board now are asked for alongside
      // the class list rather than after it — each is a round trip of about a
      // second, and a board just put up would otherwise sit with empty panes
      // for two of them. Nearly every poll calls the same two classes.
      const guess = calledIds(gateLane(classesRef.current, ring, day));
      const [res, ...guessed] = await Promise.all([
        fetch(`/api/shows/${showId}/gate/classes`, { cache: 'no-store' }),
        ...guess.map(fetchRiders),
      ]);
      const json = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(json)) {
        setOffline(true);
        return;
      }
      // Which two are called is worked out from the list just read, so a
      // class that has just gone in hands its place to the next one in this
      // same poll; only a class the guess missed is a second request.
      const fresh = json as BoardClass[];
      const wanted = calledIds(gateLane(fresh, ring, day));
      const answers = await Promise.all(
        wanted.map((id) => (guess.includes(id) ? guessed[guess.indexOf(id)] : fetchRiders(id))),
      );
      setClasses(fresh);
      setRiders((prev) => {
        const next: Record<string, BoardRider[]> = {};
        wanted.forEach((id, i) => {
          // A class whose riders did not come back keeps the last ones read.
          const got = answers[i] ?? prev[id];
          if (got) next[id] = got;
        });
        return next;
      });
      setOffline(answers.some((a) => a === null));
    } catch {
      setOffline(true);
    }
  }, [showId, ring]);

  // Poll while the board is up and in front of somebody: stop while the tab is
  // hidden and read again the moment it is back.
  useEffect(() => {
    if (!running) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const startTimer = () => {
      if (timer === null) timer = setInterval(() => void refresh(), POLL_MS);
    };
    const stopTimer = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
        startTimer();
      } else {
        stopTimer();
      }
    };
    void refresh();
    if (document.visibilityState === 'visible') startTimer();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stopTimer();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [running, refresh]);

  // Turns the page of a class with more riders than fit. One clock for both
  // panes; a pane that fits ignores it.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((i) => i + 1), PAGE_MS * preset.dwell);
    return () => clearInterval(t);
  }, [running, preset.dwell]);

  const [stageRef, stageBox] = useBoxSize();

  const lane = ring !== null && today ? gateLane(classes, ring, today) : null;
  const unitVh = preset.scale * U_VH;
  const where = ringName ?? show.venue ?? null;

  let stage: React.ReactNode;
  if (!lane) {
    stage = (
      <BoardNotice title="No classes in this ring">
        Classes the office puts in {ringName ?? 'this ring'} will be called here.
      </BoardNotice>
    );
  } else if (!lane.onDeck && lane.inRing.length === 0) {
    stage = lane.underway ? (
      <BoardNotice title="That’s the day">
        Every class in {ringName ?? 'the ring'} has gone in for {dayLabel(lane.date, today)}.
      </BoardNotice>
    ) : (
      <BoardNotice title="Nobody to call yet">No riders are entered in {ringName ?? 'this ring'}’s classes yet.</BoardNotice>
    );
  } else {
    stage = (
      <div className="w-full h-full min-h-0 flex flex-col" style={{ gap: u(1) }}>
        <InRingBanner lane={lane} />
        {lane.onDeck ? (
          <div className="flex-1 min-h-0 grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: u(1.6) }}>
            <OrderPane
              key={lane.onDeck.id}
              kind="deck"
              cls={lane.onDeck}
              riders={riders[lane.onDeck.id]}
              uPx={uPx}
              unitVh={unitVh}
              tick={tick}
            />
            {lane.inTheHole ? (
              <OrderPane
                key={lane.inTheHole.id}
                kind="hole"
                cls={lane.inTheHole}
                riders={riders[lane.inTheHole.id]}
                uPx={uPx}
                unitVh={unitVh}
                tick={tick}
              />
            ) : (
              <EmptyPane kind="hole">#{lane.onDeck.class_number} is the last class today.</EmptyPane>
            )}
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex">
            <BoardNotice title="Last class of the day">
              Nothing more to call in {ringName ?? 'this ring'} after the class in the ring.
            </BoardNotice>
          </div>
        )}
        <ComingUp classes={lane.comingUp} later={lane.later} stageU={uPx ? stageBox.w / uPx : 0} />
      </div>
    );
  }

  return (
    <BoardRoot running={running} chrome={chrome} onMouseMove={wake}>
      {!mounted ? null : !running ? (
        <GateBoardSetup
          showId={showId}
          showName={show.name}
          rings={rings}
          ring={ring}
          loadError={loadError}
          initialDuplicate={duplicate}
          onRing={(key) => setQuery({ ring: key }, 'replace')}
          onPick={start}
        />
      ) : (
        <BoardCanvas preset={preset}>
          {fill && <FillPrompt text={fill} onFill={fullscreen.enter} onKeep={keepWindowed} />}
          <BoardHeader
            showId={showId}
            title={show.name}
            subtitle={[where, lane ? dayLabel(lane.date, today) : null].filter(Boolean).join(' · ')}
            status={offline ? 'offline' : 'live'}
          />
          <main
            className="flex-1 min-h-0 flex"
            style={{ paddingInline: c(1.8), paddingTop: c(0.5), paddingBottom: c(0.8) }}
          >
            <div ref={stageRef} className="w-full h-full min-h-0 flex">
              {stage}
            </div>
          </main>

          <BoardControls
            visible={chrome}
            settingsTitle="Gate Board page — the ring and the screen size"
            size={size}
            onSettings={toSettings}
            onSize={(k) => choose(k, 'replace')}
            isFullscreen={fullscreen.isFullscreen}
            onToggleFullscreen={fullscreen.toggle}
            bottom={c(1.2)}
          />
        </BoardCanvas>
      )}
    </BoardRoot>
  );
}
