'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import Ribbon from '@/components/Ribbon';
import { errorMessage } from '@/lib/api-error';
import type { Marquee, MarqueeMode } from '@/lib/api';
import { formatPoints, topStandings, type ShowLeaderboard, type StandingLine } from '@/lib/high-point';
import {
  BoardCanvas,
  BoardControls,
  BoardHeader,
  BoardNotice,
  BoardRoot,
  CONTROL_BUTTON,
  ControlRule,
  FillPrompt,
} from '../_components/BoardChrome';
import { BoardSetupPage, HubHeading, ScreenPicker } from '../_components/BoardSetup';
import { useBoxSize } from '../_components/hooks';
import { U_VH, clamp, c, u, wrap, type SizeKey } from '../_components/units';
import { useBoardScreen } from '../_components/useBoardScreen';

/* Sizing — the two units, the three presets and why the size is asked rather
   than measured — is shared by every board: `../_components/units.ts`. So is
   everything a board does as a screen (`useBoardScreen`): full screen, a
   monitor extended or duplicated, the fade-in controls. What is here is the
   results themselves. */

/** Named, so opening the board a second time reuses its window rather than
 *  stacking another one onto the TV. Both results boards share it. */
const BOARD_WINDOW = 'gaitdesk-results-board';

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
/* The split board's two headers, both this height so the boxes under them start
   on one line: "Class Results" or "High Point" with the Top 5 badge, and the
   class or the division named on the line beneath — up to two lines of class
   name, which a half-width header needs more often than a full one. */
const SPLIT_HEAD_UC = 5.4;
const SPLIT_NAME_UC = 1.35; // the class or division name under the heading
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
  /** Whether its placings earn high-point points (migration 167). The split
   *  board does not set a class the office left out beside a division's
   *  standings it adds nothing to. Optional for an older backend: counts. */
  high_point_eligible?: boolean;
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

  // The split board heads its two halves alike — "Class Results" across from
  // "High Point", the name of the class or division under each. Ring, division
  // and discipline are left off: the division is the other half's title, and
  // which judges of the panel this is is the one thing the name does not say.
  if (split) {
    return (
      <SplitHeader
        heading="Class Results"
        name={`#${cls.class_number} · ${cls.class_name}`}
        badge={placed}
        aside={turn}
      />
    );
  }

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
        className="font-medium tracking-wide truncate max-w-full"
        style={{
          fontSize: c(0.95),
          color: 'var(--on-slate-muted)',
        }}
      >
        {context || 'Class results'}
      </div>

      <div className="flex items-center min-w-0 max-w-full" style={{ gap: c(0.8) }}>
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
      </div>
    </header>
  );
}

/** One half's header on the split board: what the half is — "Class Results"
 *  or "High Point" — with the Top 5 badge beside it, and which class or which
 *  division on the line beneath, in the accent colour. Both halves are drawn by
 *  this, at one pinned height (SPLIT_HEAD_UC, which `scaleFor` counts), so a
 *  room reads the same two lines across the screen and the boxes under them
 *  start level. The name may take two lines, then ellipsis: a clipped class
 *  name leaves the room guessing which class it is looking at. */
function SplitHeader({
  heading,
  name,
  badge = true,
  aside = null,
}: {
  heading: string;
  name: string | null;
  badge?: boolean;
  /** Beside the badge: which judges of a panel this turn shows. */
  aside?: string | null;
}) {
  return (
    <header
      className="flex-none min-w-0 flex flex-col justify-center items-center text-center"
      style={{
        height: c(SPLIT_HEAD_UC),
        marginBottom: c(CLASS_HEAD_GAP_UC),
        paddingInline: u(0.3),
      }}
    >
      <div className="flex items-center justify-center min-w-0 max-w-full" style={{ gap: c(0.8) }}>
        <h2 className="font-bold truncate min-w-0" style={{ fontSize: c(1.5), lineHeight: 1.05, color: 'var(--on-slate)' }}>
          {heading}
        </h2>
        {badge && <TopBadge />}
        {aside && (
          <span className="flex-none font-medium whitespace-nowrap" style={{ fontSize: c(1.05), color: 'var(--on-slate-muted)' }}>
            {aside}
          </span>
        )}
      </div>
      {name && (
        <div
          className="font-semibold min-w-0 max-w-full"
          style={{
            fontSize: c(SPLIT_NAME_UC),
            lineHeight: 1.05,
            marginTop: c(0.15),
            color: 'var(--accent-light)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {name}
        </div>
      )}
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
  /** On the split board: the header is centred over its half and reads
   *  "Class Results", with the class named under it, as the other half reads
   *  "High Point" over its division (`SplitHeader`). The Results Board keeps
   *  it left, with its context line. */
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

/* ── The split board: results beside high point ─────────────────────────────
   The same board halved (`layout="split"`, at `/board/results-high-point`):
   the class on the left, two of its judges' cards at a time, and the high
   point standings of **that class's division** on the right — "Amateur", its
   points added up across every discipline. Judges' boxes are quarter-width,
   the width a four-judge class's cards already are on the Results Board, so
   every size, the compact row and the top five all carry over unchanged.

   **A panel of more than two takes turns**: judges one and two, then three
   and four, with the header saying which ("Judges 1–2 of 4"). A class with a
   single card, or the third judge of three, gets the whole half, as the
   standings table always does.

   **One division at a time** (`buildSplitTurns`): a division's standings hold
   the right half while each of its classes posted today takes a turn on the
   left, then both halves move on to the next division together. The halves
   used to turn through their own lists, two standings tables at a time, and
   the show office asked for one division across the screen: a room reading
   an Amateur class beside the Open and Youth tables had to work out which
   table its horse was in.

   **A standing reads like a placing**: the same rosette for its rank and the
   back number in the same place, so a room finds its number and its colour
   on either half without learning a second layout.

   **One clock**, so the dwell bar still means "this screen is about to
   change", and a pause holds both halves. */

const SPLIT_CARDS = 2;
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
/** One dot of a leader and the space after it; a leader is never narrower. */
const LEADER_DOT_U = 0.6;

type DivisionPane = { name: string; lines: StandingLine[] };

/** A division name as the standings match it: spaces collapsed, case
 *  ignored — `_division_key` in `backend/high_point.py`, so a class in
 *  "Amateur " is shown beside the "Amateur" table. Empty for no division. */
function divisionKey(name: string | null | undefined): string {
  return (name ?? '').split(/\s+/).filter(Boolean).join(' ').toLowerCase();
}

/** One screen of the split board: a class (or a pair of its cards) on the
 *  left, its division's standings on the right. */
type SplitTurn = {
  /** Which division of the rotation this is — what keys the right half, so
   *  the table stays put while its division's classes turn over beside it. */
  division: number;
  /** The division as the room reads it; null for classes in no division. */
  divisionName: string | null;
  /** Null for a division with standings but no class posted today. */
  block: Block | null;
  /** Null for a division that has earned no points yet, or no division. */
  pane: DivisionPane | null;
  /** False for the classes the office left out of high point (migration 167),
   *  which take their turns together at the end beside a notice saying so. */
  counts: boolean;
};

/** The group the classes left out of high point go in — never a division's
 *  key, which is a division name made lower case. */
const NOT_COUNTED = '\u0000not-counted';

/** The split board's rotation, a division at a time. Divisions come in the
 *  show's own order — the order the standings arrive in — then any division
 *  whose classes have earned no points yet, in the order its classes were
 *  posted, and classes in no division last. Within a division the classes
 *  keep `blocks`' order, newest posted first.
 *
 *  A division with standings and no class posted today still gets one turn,
 *  its table beside a notice: the points are the whole show's and the classes
 *  only the day's, and leaving it out would take its standings off the board
 *  for the rest of the show.
 *
 *  A class the office left out of high point is not set beside its division's
 *  standings, which it adds nothing to — a room would read its winner as
 *  having earned the points in the table. Those classes come last of all,
 *  beside a notice saying they do not count. */
function buildSplitTurns(blocks: Block[], panes: DivisionPane[]): SplitTurn[] {
  type Group = { key: string; name: string | null; pane: DivisionPane | null; blocks: Block[] };
  const groups: Group[] = [];
  const byKey = new Map<string, Group>();
  const add = (group: Group) => {
    groups.push(group);
    byKey.set(group.key, group);
    return group;
  };
  for (const pane of panes) add({ key: divisionKey(pane.name), name: pane.name, pane, blocks: [] });
  for (const block of blocks) {
    const counts = block.cls.high_point_eligible !== false;
    const key = counts ? divisionKey(block.cls.division_name) : NOT_COUNTED;
    const name = counts ? block.cls.division_name?.trim() || null : null;
    const group = byKey.get(key) ?? add({ key, name, pane: null, blocks: [] });
    group.blocks.push(block);
  }
  // Every division, then classes in no division, then the classes that do not
  // count (a stable sort keeps the rest in order).
  const last = (key: string) => (key === NOT_COUNTED ? 2 : key === '' ? 1 : 0);
  groups.sort((a, b) => last(a.key) - last(b.key));
  return groups.flatMap((group, division) =>
    (group.blocks.length ? group.blocks : [null]).map((block) => ({
      division,
      divisionName: group.name,
      block,
      pane: group.pane,
      counts: group.key !== NOT_COUNTED,
    })),
  );
}

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

/** One division's standings, shaped like a judge's card beside it, the rows at
 *  the same height. The division is named in the header over it ("High Point",
 *  then "Amateur"), the way the class beside it is named under "Class
 *  Results" — so the box carries no title of its own. Its rows sit in the
 *  middle of the box, as a card's do, and JUDGE_HEAD_U that `scaleFor` still
 *  counts for it is slack, never overflow. */
function DivisionBox({ pane, compact }: { pane: DivisionPane; compact: boolean }) {
  return (
    <div className="flex flex-col min-h-0 min-w-0 overflow-hidden" style={PANE_STYLE}>
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

/** The right half: the division's standings table, or why there is none —
 *  said without the header, so it sits level with "Waiting on results" beside
 *  it. */
function HighPointBlock({
  leaderboard,
  pane,
  divisionName,
  counts = true,
  stageU,
  unitVh,
  scale,
}: {
  leaderboard: ShowLeaderboard | null;
  pane: DivisionPane | null;
  /** The division this screen is on, for saying why it has no table. Null for
   *  classes in no division; undefined when the board has nothing to turn. */
  divisionName?: string | null;
  /** False beside the classes the office left out of high point. */
  counts?: boolean;
  /** The half's width in the board's --u, which decides the compact row
   *  exactly as it does for the judges' cards beside it. */
  stageU: number;
  unitVh: number;
  scale: number;
}) {
  const compact = stageU > 0 && stageU / scale < COMPACT_CARD_U;
  return (
    <section className="w-full h-full flex flex-col min-h-0 min-w-0 animate-[board-fade-in_0.4s_ease-out]">
      {!counts && leaderboard?.point_system ? (
        <BoardNotice title="High Point">
          {/* Said rather than left blank: a room reading a winner beside an
              empty half would wonder where the points went. */}
          This class does not count toward high point.
        </BoardNotice>
      ) : pane && leaderboard?.point_system ? (
        <>
          {/* The same two lines as the class across from it: what this half
              is, and which division — the split board's two headers are one
              component (`SplitHeader`) so they cannot drift apart. */}
          <SplitHeader heading="High Point" name={pane.name} />
          <div
            className="flex-1 min-h-0 grid"
            style={{ '--u': `${(unitVh * scale).toFixed(3)}vh` } as React.CSSProperties}
          >
            <DivisionBox pane={pane} compact={compact} />
          </div>
        </>
      ) : !leaderboard ? (
        // The poll brings it back; nothing for the room to do about it.
        <BoardNotice title="High Point">The standings will be back in a moment.</BoardNotice>
      ) : !leaderboard.point_system ? (
        <BoardNotice title="No high point">High point is not being kept at this show.</BoardNotice>
      ) : leaderboard.divisions.length === 0 || divisionName === undefined ? (
        <BoardNotice title="High Point">
          Standings start as soon as the first class is judged and its placings are posted.
        </BoardNotice>
      ) : divisionName === null ? (
        // Standings are per division; a class in none earns toward no table.
        <BoardNotice title="High Point">This class is not in a division, so it earns no high point.</BoardNotice>
      ) : (
        <BoardNotice title={divisionName}>No high point points have been earned in this division yet.</BoardNotice>
      )}
    </section>
  );
}

/** The split board's stage: the class on the left, its division's standings on
 *  the right, an accent rule in a wide gutter between (SPLIT_GAP_U,
 *  SPLIT_RULE_U). The right half is keyed on the division, so its table stays
 *  put while that division's classes turn over beside it. */
function SplitStage({
  turn,
  turnKey,
  anyPosted,
  leaderboard,
  stageU,
  unitVh,
  scale,
}: {
  turn: SplitTurn | null;
  turnKey: number;
  /** Whether any class has been posted today — what tells "waiting on
   *  results" from a division with standings but no class today. */
  anyPosted: boolean;
  leaderboard: ShowLeaderboard | null;
  stageU: number;
  unitVh: number;
  scale: number;
}) {
  const halfU = stageU > 0 ? (stageU - 2 * SPLIT_GAP_U - SPLIT_RULE_U) / 2 : 0;
  return (
    <div className="w-full h-full min-h-0 min-w-0 flex">
      <div className="flex-1 min-w-0 min-h-0 flex">
        {turn?.block ? (
          <ClassBlock key={turnKey} block={turn.block} stageU={halfU} unitVh={unitVh} scale={scale} split />
        ) : anyPosted && turn?.divisionName ? (
          <BoardNotice key={turnKey} title={turn.divisionName}>
            No {turn.divisionName} classes have been posted today.
          </BoardNotice>
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
          key={turn?.division ?? -1}
          leaderboard={leaderboard}
          pane={turn?.pane ?? null}
          divisionName={turn ? turn.divisionName : undefined}
          counts={turn?.counts ?? true}
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

/** The Results Board page — reached from Live Screens, and where the board
 *  opens onto when it is not running. How big the panel is (the shared
 *  `ScreenPicker`), and what the marquee says. */
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
  return (
    <BoardSetupPage showId={showId} showName={showName} title={title} notice={notice}>
      <ScreenPicker windowName={BOARD_WINDOW} initialDuplicate={initialDuplicate} onPick={onPick} />

      <section>
        <HubHeading title="Marquee" note="What scrolls along the bottom of the board." />
        <MarqueeEditor showId={showId} marquee={marquee} />
      </section>
    </BoardSetupPage>
  );
}

/* ── The board ──────────────────────────────────────────────────────────── */

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
  // Counts turns and never wraps: the screen is `wrap(tick, turns)`, so a poll
  // that adds a class carries on from about where it was.
  const [tick, setTick] = useState(0);
  const [paused, setPaused] = useState(false);

  const step = useCallback((delta: number) => {
    setPaused(true); // stepping by hand means you want to look at it
    setTick((i) => i + delta);
  }, []);

  // Space pauses and the arrows step, on a running board. The keys every
  // board takes — the sizes and full screen — are `useBoardScreen`'s.
  const onBoardKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault();
        setPaused((p) => !p);
      } else if (e.key === 'ArrowRight') {
        step(1);
      } else if (e.key === 'ArrowLeft') {
        step(-1);
      }
    },
    [step],
  );

  const { mounted, size, duplicate, preset, uPx, ucPx, fullscreen, fill, keepWindowed, chrome, wake, pinChrome, setQuery, choose, start, toSettings } =
    useBoardScreen({ noun: 'the results board', onBoardKey });

  // The screen time rides beside `?size=` as `?every=`, for the same reasons
  // the size does: it belongs to this screen, it has to survive the TV's
  // browser reloading, and it must not follow the office to the next show.
  const searchParams = useSearchParams();
  const every = parseEvery(searchParams.get('every'));

  const [gridRef, gridBox] = useBoxSize();

  const chooseEvery = useCallback(
    (seconds: number | null) => setQuery({ every: seconds == null ? null : String(seconds) }, 'replace'),
    [setQuery],
  );

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
    // The split board's headers carry a second line, the class or division
    // under its heading, and are pinned taller (SPLIT_HEAD_UC).
    const headUc = split ? SPLIT_HEAD_UC : CLASS_HEAD_UC;
    const available = gridBox.h - (headUc + CLASS_HEAD_GAP_UC) * ucPx - 2;
    return (judges: number, rows: number) => {
      const g = screenGrid(judges);
      const box = PANE_PAD_U + (judges > 1 ? JUDGE_HEAD_U : 0) + Math.max(rows, 1) * ROW_U;
      const needU = box * g.rows + GRID_GAP_U * (g.rows - 1);
      return Math.min(1, available / (needU * uPx));
    };
  }, [uPx, ucPx, gridBox.h, split]);

  const slides = useMemo(() => {
    const blocks = buildBlocks(postedToday, groups);
    return split ? buildSplitBlocks(blocks) : blocks;
  }, [postedToday, groups, split]);

  // The split board's screens, a division at a time: each of its classes
  // beside its standings. The whole show's standings, not the day's: points
  // add up across every posted class.
  const splitTurns = useMemo(() => {
    if (!split) return [];
    const panes = leaderboard?.point_system
      ? leaderboard.divisions.map(
          (d): DivisionPane => ({ name: d.name, lines: topStandings(d.standings, TOP_PLACES, STANDING_ROWS) }),
        )
      : [];
    return buildSplitTurns(slides, panes);
  }, [split, slides, leaderboard]);

  const turns = split ? splitTurns.length : slides.length;
  const turnAt = turns ? wrap(tick, turns) : 0;
  const turn = split && turns ? splitTurns[turnAt] : null;
  const active = split ? (turn?.block ?? null) : slides.length ? slides[turnAt] : null;
  const paneRows = turn?.pane?.lines.length ?? 0;
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

  return (
    <BoardRoot running={size !== null} chrome={chrome} onMouseMove={wake}>
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
        <BoardCanvas preset={preset}>
          {fill && <FillPrompt text={fill} onFill={fullscreen.enter} onKeep={keepWindowed} />}
          <BoardHeader
            showId={showId}
            title={show.name}
            subtitle={show.venue}
            status={paused ? 'paused' : 'live'}
            // The show's public Results page, one scan from anybody watching —
            // no account needed, which is why that page stays public. Built
            // from the address the board itself is on, so it points at the
            // right site in every environment.
            qr={{
              value: `${window.location.origin}/shows/${showId}/results`,
              caption: 'Scan for full results →',
              label: "QR code: this show's results",
            }}
          />

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
                  turn={turn}
                  turnKey={turnAt}
                  anyPosted={slides.length > 0}
                  leaderboard={leaderboard}
                  stageU={uPx ? gridBox.w / uPx : 0}
                  unitVh={preset.scale * U_VH}
                  // One scale for both halves, so a placing and a standing are
                  // the same size and their rows run across on one line.
                  scale={scaleFor(
                    SPLIT_CARDS,
                    Math.max(active ? blockDepth(active) : 0, paneRows),
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

          {/* Back to the Results Board page, where the board was started from
              — the screen sizes and the marquee message. */}
          <BoardControls
            visible={chrome}
            settingsTitle={`${boardName} page — screen size and the marquee message`}
            size={size}
            onSettings={toSettings}
            onSize={(k) => choose(k, 'replace')}
            isFullscreen={fullscreen.isFullscreen}
            onToggleFullscreen={fullscreen.toggle}
          >
            <ControlRule />
            {/* With the other controls of the rotation, beside pause and step.
                A menu rather than a stepper, because the useful jump is from
                "a few seconds" to "a few minutes" and a stepper would make that
                a dozen presses. */}
            <label
              className="flex items-center whitespace-nowrap"
              style={{ ...CONTROL_BUTTON, gap: c(0.35) }}
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
                onFocus={() => pinChrome(true)}
                onBlur={() => pinChrome(false)}
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
            <button type="button" onClick={() => step(-1)} className="rounded" style={CONTROL_BUTTON}>
              ‹
            </button>
            <button type="button" onClick={() => setPaused((p) => !p)} className="rounded" style={CONTROL_BUTTON}>
              {paused ? '▶' : '❙❙'}
            </button>
            <button type="button" onClick={() => step(1)} className="rounded" style={CONTROL_BUTTON}>
              ›
            </button>
          </BoardControls>
        </BoardCanvas>
      )}
    </BoardRoot>
  );
}
