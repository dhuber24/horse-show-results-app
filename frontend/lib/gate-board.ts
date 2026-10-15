/**
 * What the gate board shows for one ring: the class in the ring, the class on
 * deck and the one in the hole with their riders, and what comes after.
 *
 * **The board follows the gate steward, and nothing else.** A class is in the
 * ring once the gate starts it and over once the gate finishes, skips or
 * closes it; on deck is the first class the gate has not started — the rule
 * the steward's own screen and `gate_rules.on_deck` hold. Posted results do
 * not move it. The board is the gate's, read at the gate, and it calls riders
 * by what the steward has done there.
 *
 * It read the public schedule's badge (`classProgress`) at first, which also
 * counts a posted class as over and every class ahead of it with it. That
 * held for a show whose results are posted in running order, but one posted
 * class further down the day closed every class above it, riders still
 * waiting and nothing started — a show with class 7 posted and classes 2 to 4
 * unrun read "That's the day". The schedule keeps its rule for the shows that
 * post without a gate; this board is only any use where the gate is worked.
 *
 * Pure, so the rules are pinned by `gate-board.test.ts`.
 */

/** In the ring or finished, at the gate. A `ready` on an older row is not
 *  started — the gate's own reading (`gate_rules.started`). */
function started(c: BoardClass): boolean {
  return c.gate_status === 'in_progress' || c.gate_status === 'done';
}

/** One class as `GET /shows/{id}/gate/classes` serves it — the fields the
 *  board reads. */
export type BoardClass = {
  id: string;
  class_number: string;
  class_name: string;
  class_date: string;
  status: string;
  ring_id: string | null;
  ring_name: string | null;
  ring_sort_order?: number | null;
  /** As the gate serves it: `pending`, `ready` (derived — not started),
   *  `in_progress` or `done`. */
  gate_status: string;
  /** Riders not scratched. */
  entry_count: number;
  checked_in_count?: number;
  no_show_count?: number;
  /** How the class is placed: `placing` (a rail class, ridden together),
   *  `scored`, `equitation` or `timed` (worked one at a time). */
  effective_card_type?: string | null;
};

/** One rider as `GET /shows/{id}/gate/classes/{cid}/entries` serves them,
 *  already in the gate's order: order of go, then back number. */
export type BoardRider = {
  id: string;
  back_number: number | null;
  exhibitor_name: string;
  horse_name: string | null;
  gate_order: number | null;
  gate_checked_in: boolean;
  /** Called for and never came (migration 162). Not a scratch. */
  gate_no_show: boolean;
};

/** The ring key of a class with no ring set — a show that never named its
 *  rings runs every class in this one. */
export const NO_RING = 'none';

export function ringKey(c: Pick<BoardClass, 'ring_id'>): string {
  return c.ring_id ?? NO_RING;
}

/** Draft classes are not on the public schedule, so they are not called to
 *  the gate either. */
function visible(classes: BoardClass[]): BoardClass[] {
  return classes.filter((c) => c.status !== 'DRAFT');
}

export type BoardRing = { key: string; name: string | null };

/** The rings the show runs classes in, in the show's ring order. */
export function boardRings(classes: BoardClass[]): BoardRing[] {
  const rings = new Map<string, { name: string | null; order: number | null }>();
  for (const c of visible(classes)) {
    const key = ringKey(c);
    if (!rings.has(key)) rings.set(key, { name: c.ring_name, order: c.ring_sort_order ?? null });
  }
  return Array.from(rings, ([key, r]) => ({ key, ...r }))
    .sort(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
        (a.name ?? '').localeCompare(b.name ?? ''),
    )
    .map(({ key, name }) => ({ key, name }));
}

/**
 * Which of the ring's days the board shows: today when the ring runs classes
 * today; otherwise the next day it does, so a board put up the evening before
 * shows the morning's first classes; and once the show is over, its last day.
 *
 * Never the first day with something unfinished: a class nobody marked done
 * on Saturday would hold the board on Saturday all through Sunday.
 */
export function boardDay(dates: string[], today: string): string | null {
  const days = Array.from(new Set(dates)).sort();
  if (days.length === 0) return null;
  if (days.includes(today)) return today;
  return days.find((d) => d > today) ?? days[days.length - 1];
}

/** How many classes the strip along the bottom names after the one in the hole. */
export const COMING_UP = 4;

export type GateLane = {
  /** The day shown, `YYYY-MM-DD`. */
  date: string;
  /** In the ring now — more than one when classes are run together. */
  inRing: BoardClass[];
  /** Whether anything has gone in yet today, finished or in the ring. */
  underway: boolean;
  onDeck: BoardClass | null;
  inTheHole: BoardClass | null;
  comingUp: BoardClass[];
  /** Classes still to come after the strip. */
  later: number;
};

/**
 * The gate board for one ring on the day `boardDay` picks, or null when the
 * ring has no classes at all.
 *
 * The classes come in running order — the order the gate's list hands them
 * over in — and nothing here sorts.
 */
export function gateLane(classes: BoardClass[], ring: string, today: string): GateLane | null {
  const ringClasses = visible(classes).filter((c) => ringKey(c) === ring);
  const date = boardDay(
    ringClasses.map((c) => c.class_date),
    today,
  );
  if (date === null) return null;

  const lane = ringClasses.filter((c) => c.class_date === date);

  // Every class the gate has not started, in running order — the first of
  // them is the gate's on-deck class. A class nobody is entered in is never
  // ridden — the steward skips it — so it is passed over rather than called:
  // the riders of the class after it are the ones who need to be getting
  // ready. That is the one place the board and the steward's screen differ.
  const toCome = lane.filter((c) => !started(c) && c.entry_count > 0);

  return {
    date,
    inRing: lane.filter((c) => c.gate_status === 'in_progress'),
    underway: lane.some(started),
    onDeck: toCome[0] ?? null,
    inTheHole: toCome[1] ?? null,
    comingUp: toCome.slice(2, 2 + COMING_UP),
    later: Math.max(0, toCome.length - 2 - COMING_UP),
  };
}

/**
 * Whether the board numbers a class's riders in their order of go.
 *
 * A class worked one at a time — scored, equitation, timed — goes in the order
 * the gate holds, and "you are fourth" is the thing a rider wants to know. A
 * rail class rides in together, so its list is only the back numbers sorted,
 * and numbering it 1 to 12 would read as a running order nobody is keeping —
 * unless the steward has set one, by hand or by draw, which says it is kept.
 */
export function numbersOrderOfGo(cls: Pick<BoardClass, 'effective_card_type'>, riders: BoardRider[]): boolean {
  if (cls.effective_card_type && cls.effective_card_type !== 'placing') return true;
  return riders.some((r) => r.gate_order != null);
}

export type RiderTally = { riders: number; checkedIn: number; noShow: number };

/** Where a class's riders stand at the gate: checked in, a no-show, or neither. */
export function riderTally(riders: BoardRider[]): RiderTally {
  return {
    riders: riders.length,
    checkedIn: riders.filter((r) => r.gate_checked_in && !r.gate_no_show).length,
    noShow: riders.filter((r) => r.gate_no_show).length,
  };
}

/** Today as `YYYY-MM-DD` in the reader's own zone — the show's, since the
 *  board is on a screen at the show. A server renders in UTC, hours out by
 *  evening, so this is only ever called in the browser. */
export function localToday(now: Date = new Date()): string {
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
}
