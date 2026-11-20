'use client';

import { useRef, useState } from 'react';
import { errorMessage } from '@/lib/api-error';
import { DEFAULT_TIME, timeForDay } from '@/lib/default-time';
import { unitLabel } from '@/lib/fee-units';
import {
  defaultMoveIn,
  defaultPassMoveIn,
  EARLY_MOVE_IN_CODE,
  EARLY_MOVE_IN_CODES,
  EARLY_MOVE_IN_PREFIX,
  formatStallsOpen,
  isEarlyMoveInPass,
  passMoveIn,
  passMovesInFirst,
} from '@/lib/stalls-open';
import {
  isStallType,
  periodWindow,
  STALL_KIND_OPTIONS,
  STALL_TYPE_LABEL,
  STALL_TYPES,
  type StallKind,
  type StallPeriod,
  type StallType,
} from '@/lib/stall-periods';
import {
  COLORS,
  MOVE_IN_NOTES_MAX,
  NOTES_MAX,
  PRICE_COLS,
  centsToDollars,
  dollarsToCents,
  earlyFields,
  oneParagraph,
  type EarlyFields,
} from './fields';

/**
 * The *Stalls & move-in* card on the Lodging step (migrations 194–198): the
 * stall periods a show sells stalls for, each with its move-in and move-out,
 * its stall prices and its own Early Move-In Pass, and whether every horse
 * entered needs its own stall.
 *
 * Everything is set by stall period — a period is what lets a show charge
 * different amounts for different parts of the show. A period has its own
 * move-in and move-out; its prices for the three stall types, box, tie and
 * tack, each on its own (`StallPrices`: blank for a type it does not offer,
 * an optional early price until one reserve-by day for the period, notes, and
 * a tack stall's horse minimum); and, where the office ticks it, its own Early
 * Move-In Pass. Exhibitors book how many of each type they want at sign-up. A
 * show selling every stall for the whole show has one period, *Full show*.
 *
 * Each priced type is one `per_stall` line (`stall_kind`, migration 198), named
 * for its type and period. The types are fixed — nothing is named, added or
 * removed but the periods — and a line goes when its period does. Anything
 * else already priced per stall (a second line of one type in a period, an
 * add-on such as a cleaning deposit, a line booked for the whole show) is
 * shown as it is under *Other charges per stall*, to reprice or stop.
 *
 * There is no separate *Stalls open* day to keep in step with the periods —
 * the backend makes it the first period's move-in when they are saved, and
 * clears it with the last one (`stabling.stalls_open_from`).
 *
 * A show without periods that still carries something from before them — a
 * *Stalls open* day, or a stall line or whole-show pass nobody has booked (the
 * show bill import makes both) — opens on a *Full show* period made from it,
 * so nothing exhibitors are told goes unseen here. The only lines and pass
 * left outside a period are ones exhibitors booked for the whole show before
 * it had periods: they keep what was bought, under *Other charges per stall*.
 *
 * A pass is priced per stall or once per exhibitor (`one_per_exhibitor`,
 * migration 196). Its move-in day is filled in as the day before its period's
 * move-in at the same hour (`defaultPassMoveIn`) and follows that move-in until
 * the office types its own.
 *
 * The state lives in `useStallsEditor` so `LodgingClient` can fold it into the
 * step's one save and one dirty check — the step's autosave is a single flush.
 */

export type StallFeeRow = {
  id: string;
  code: string;
  label: string;
  amount_cents: number;
  unit: string;
  notes: string | null;
  early_amount_cents: number | null;
  early_deadline: string | null;
  early_deadline_time?: string | null;
  reserved_count?: number;
  /** What the line sells, stated or read from the line by the backend. */
  stall_kind?: StallKind | null;
  stall_period_id?: string | null;
  horses_per_tack_stall?: number | null;
  /** A pass's own move-in day and hour (migration 195). */
  move_in_date?: string | null;
  move_in_time?: string | null;
  /** When that window closes (migration 203). */
  move_in_end_date?: string | null;
  move_in_end_time?: string | null;
  /** A pass priced and booked once per exhibitor (migration 196). */
  one_per_exhibitor?: boolean;
};

/** A line this card lists as a stall type: anything priced per stall but
 *  an Early Move-In Pass, which each move-in carries for itself. */
export function isStallLine(fee: { unit: string; code: string }): boolean {
  return fee.unit === 'per_stall' && !isEarlyMoveInPass(fee);
}

/** Codes something else on the show finds its row by. A new stall line never
 *  takes one — except `stall` itself, for the show's first horse stall. */
const RESERVED_CODES = new Set(['shavings', 'camping', 'hookup', ...EARLY_MOVE_IN_CODES]);

/** The whole show, as against a period: a line sold for no period, or a pass
 *  booked before the show had any. */
const WHOLE_SHOW = '';

/** The key of the period a show opens on when it carries a move-in from
 *  before stall periods. */
const CARRIED = 'carried';

type PeriodDraft = {
  /** Stable for the life of the screen; an id once saved, `new-N` before. */
  key: string;
  id: string | null;
  name: string;
  moveInDate: string;
  moveInTime: string;
  moveOutDate: string;
  moveOutTime: string;
  moveOutNote: string;
  /** What exhibitors should know about moving in for this period (migration
   *  199): each period can have its own instructions. */
  moveInNotes: string;
  /** When the period's early stall prices end: one reserve-by day and optional
   *  hour for its box, tie and tack stalls, written to each line priced early.
   *  Not part of the period row. */
  earlyDeadline: string;
  earlyDeadlineTime: string;
  /** Made on opening, and not saved yet: from the show's *Stalls open* day,
   *  or to hold the stall types and pass it sold for the whole show when it had
   *  no such day. */
  carried?: 'stalls-open' | 'stalls';
};

type LineDraft = {
  key: string;
  feeId: string | null;
  code: string | null;
  label: string;
  /** True while the name is the one this card made up, so it follows the kind
   *  and the period until somebody types their own. */
  nameAuto: boolean;
  kind: StallKind;
  /** A `PeriodDraft.key`, or '' for the whole show. */
  periodKey: string;
  dollars: string;
  earlyDollars: string;
  earlyDeadline: string;
  earlyDeadlineTime: string;
  notes: string;
  horsesPerTack: string;
  reservedCount: number;
  /** A period's stall type is offered while ticked, and its fields show only
   *  then; unticked, it is not sold (deleted on save if it was). Always true
   *  for any other line. */
  offered: boolean;
};

/** One move-in's Early Move-In Pass, keyed by the period's key or `WHOLE_SHOW`. */
type PassDraft = {
  feeId: string | null;
  code: string | null;
  /** The row's own label, kept for the whole-show pass (a bill's wording). */
  label: string | null;
  unit: string;
  offered: boolean;
  dollars: string;
  perExhibitor: boolean;
  /** Follows its move-in's suggestion until the office types a day or hour. */
  auto: boolean;
  /** When pass holders' move-in ends (migration 203): optional, blank until
   *  the office types it. Only sent with a start. */
  endDate: string;
  endTime: string;
  /** The pass's own wording, `show_fees.notes`: limited, one trailer each. */
  notes: string;
  typedDate: string;
  typedTime: string;
  reservedCount: number;
};

const KIND_BASE: Record<StallKind, string> = { ...STALL_TYPE_LABEL, add_on: 'Add-on' };

/** A period's stall price as it reads on the bill and the sign-up form:
 *  "Box stall — Full show". */
function autoName(kind: StallKind, periodName: string): string {
  const name = periodName.trim();
  return name ? `${KIND_BASE[kind]} — ${name}` : KIND_BASE[kind];
}

const hhmm = (value: string | null | undefined) => (value ?? '').slice(0, 5);

function periodFromRow(p: StallPeriod): PeriodDraft {
  return {
    key: p.id,
    id: p.id,
    name: p.name,
    moveInDate: p.move_in_date,
    moveInTime: hhmm(p.move_in_time),
    moveOutDate: p.move_out_date,
    moveOutTime: hhmm(p.move_out_time),
    moveOutNote: p.move_out_note ?? '',
    moveInNotes: p.move_in_notes ?? '',
    earlyDeadline: '',
    earlyDeadlineTime: '',
  };
}

function periodPayload(p: PeriodDraft) {
  return {
    id: p.id,
    name: p.name.trim(),
    move_in_date: p.moveInDate,
    move_in_time: p.moveInTime || null,
    move_out_date: p.moveOutDate,
    move_out_time: p.moveOutTime || null,
    move_out_note: p.moveOutNote.trim() || null,
    move_in_notes: p.moveInNotes.trim() || null,
  };
}

/** What the draft shows for a period, for the preview under it. */
function asPeriod(p: PeriodDraft): StallPeriod {
  return { ...periodPayload(p), id: p.key, name: p.name };
}

/** A new period's draft, empty but for its key and the show's days. */
function emptyPeriod(key: string, showStartDate: string, showEndDate: string): PeriodDraft {
  return {
    key,
    id: null,
    name: '',
    moveInDate: showStartDate,
    moveInTime: DEFAULT_TIME,
    moveOutDate: showEndDate,
    moveOutTime: DEFAULT_TIME,
    moveOutNote: '',
    moveInNotes: '',
    earlyDeadline: '',
    earlyDeadlineTime: '',
  };
}

/** The line that holds a period's price for one stall type: the first of that
 *  type sold for it. Any other is an *Other charge per stall*. */
function cellIn(lines: LineDraft[], periodKey: string, kind: StallType): LineDraft | undefined {
  return periodKey ? lines.find((l) => l.periodKey === periodKey && l.kind === kind) : undefined;
}

/** The first move-in of these periods — what *Stalls open* is — or null. A day
 *  with no hour counts from the start of that day, as `stabling` reads it. */
function earliestOf(periods: PeriodDraft[]): { date: string; time: string } | null {
  const dated = periods.filter((p) => p.moveInDate);
  if (!dated.length) return null;
  const first = dated.reduce((a, b) =>
    `${b.moveInDate}T${b.moveInTime || '00:00'}` < `${a.moveInDate}T${a.moveInTime || '00:00'}` ? b : a,
  );
  return { date: first.moveInDate, time: first.moveInTime };
}

function lineFromFee(fee: StallFeeRow, periodKeys: Set<string>): LineDraft {
  const period = fee.stall_period_id ?? '';
  return {
    key: fee.id,
    feeId: fee.id,
    code: fee.code,
    label: fee.label,
    nameAuto: false,
    kind: fee.stall_kind ?? 'box',
    periodKey: periodKeys.has(period) ? period : '',
    dollars: centsToDollars(fee.amount_cents),
    earlyDollars: fee.early_amount_cents != null ? centsToDollars(fee.early_amount_cents) : '',
    earlyDeadline: fee.early_deadline ?? '',
    earlyDeadlineTime: hhmm(fee.early_deadline_time),
    notes: fee.notes ?? '',
    horsesPerTack: fee.horses_per_tack_stall ? String(fee.horses_per_tack_stall) : '',
    reservedCount: fee.reserved_count ?? 0,
    offered: true,
  };
}

function passFromFee(fee: StallFeeRow): PassDraft {
  return {
    feeId: fee.id,
    code: fee.code,
    label: fee.label,
    unit: fee.unit,
    offered: true,
    dollars: centsToDollars(fee.amount_cents),
    perExhibitor: Boolean(fee.one_per_exhibitor),
    // A day on file is the office's; none is filled in, as stalls opening is.
    auto: !fee.move_in_date,
    typedDate: fee.move_in_date ?? '',
    typedTime: hhmm(fee.move_in_time),
    endDate: fee.move_in_end_date ?? '',
    endTime: hhmm(fee.move_in_end_time),
    notes: fee.notes ?? '',
    reservedCount: fee.reserved_count ?? 0,
  };
}

function emptyPass(): PassDraft {
  return {
    feeId: null,
    code: null,
    label: null,
    unit: 'per_stall',
    offered: false,
    dollars: '',
    perExhibitor: false,
    auto: true,
    typedDate: '',
    typedTime: '',
    endDate: '',
    endTime: '',
    notes: '',
    reservedCount: 0,
  };
}

/** The tack minimum as the backend takes it: a whole number 1–20 on a tack
 *  stall, otherwise none. Undefined means what was typed cannot be sent. */
function horsesPerTackOf(line: LineDraft): number | null | undefined {
  if (line.kind !== 'tack' || line.horsesPerTack.trim() === '') return null;
  const n = Number(line.horsesPerTack);
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : undefined;
}

export type StallsEditor = ReturnType<typeof useStallsEditor>;

export function useStallsEditor({
  showId,
  fees,
  periods,
  stallPerHorse,
  takenCodes,
  showStartDate,
  showEndDate,
  stallsOpenDateOnFile,
  stallsOpenTimeOnFile,
}: {
  showId: string;
  /** The step's fees; this keeps the stall lines and the passes. */
  fees: StallFeeRow[];
  periods: StallPeriod[];
  stallPerHorse: boolean;
  /** Every fee code on the show, so a new line's code is unique. */
  takenCodes: string[];
  showStartDate: string;
  showEndDate: string;
  /** `shows.stalls_open_*` as saved: the first period's move-in, or a day set
   *  before stall periods, which a show without them carries into its first.
   *  yyyy-mm-dd and HH:MM, or ''. */
  stallsOpenDateOnFile: string;
  stallsOpenTimeOnFile: string;
}) {
  const stallFees = fees.filter(isStallLine);
  const passFees = fees.filter(isEarlyMoveInPass);
  const nextKey = useRef(0);
  const newKey = () => `new-${++nextKey.current}`;

  /** A show's first period: the whole show, moving in when its stalls opened
   *  before it had periods — or, with no day on file, the day before the show
   *  at noon — and out on its last day. */
  function firstPeriod(key: string): PeriodDraft {
    const suggested = defaultMoveIn(showStartDate);
    return {
      key,
      id: null,
      name: 'Full show',
      moveInDate: stallsOpenDateOnFile || suggested?.date || showStartDate,
      moveInTime: stallsOpenDateOnFile ? stallsOpenTimeOnFile : suggested?.time ?? '',
      moveOutDate: showEndDate,
      // Noon, like every time field — but a day carried from before periods
      // keeps the hour it was saved with, or none.
      moveOutTime: stallsOpenDateOnFile ? '' : DEFAULT_TIME,
      moveOutNote: '',
      moveInNotes: '',
      earlyDeadline: '',
      earlyDeadlineTime: '',
    };
  }

  // The periods the card opens on. A show without any that still carries
  // something from before them — a *Stalls open* day, or a stall type or pass
  // sold for the whole show that nobody has booked — opens on a *Full show*
  // period made from it, which the step's save writes like any other change.
  // A show with none of those opens on none, and the office adds the first.
  //
  // Each period prices its box, tie and tack stalls: the first line of each
  // type sold for it, or an empty one, which saves nothing until it is priced.
  // Its early prices end on one reserve-by day, read off those lines.
  const [opening] = useState<{ periods: PeriodDraft[]; lines: LineDraft[] }>(() => {
    let start: PeriodDraft[] = periods.map(periodFromRow);
    if (!start.length) {
      const movable = (fee: StallFeeRow) => !fee.stall_period_id && !fee.reserved_count;
      const carries = Boolean(stallsOpenDateOnFile) || stallFees.some(movable) || passFees.some(movable);
      if (carries) start = [{ ...firstPeriod(CARRIED), carried: stallsOpenDateOnFile ? 'stalls-open' : 'stalls' }];
    }
    const keys = new Set(start.map((period) => period.key));
    const first = start[0];
    const out = stallFees.map((fee) => {
      const line = lineFromFee(fee, keys);
      // Every stall belongs to a period. One sold for the whole show that
      // nobody has booked joins the first; a booked one keeps what was bought.
      if (first && !line.periodKey && !line.reservedCount) line.periodKey = first.key;
      return line;
    });
    for (const period of start) {
      for (const kind of STALL_TYPES) {
        if (!cellIn(out, period.key, kind)) out.push(blankLine(`${period.key}-${kind}`, kind, period.key, period.name));
      }
    }
    const withDeadlines = start.map((period) => {
      const dated = STALL_TYPES.map((kind) => cellIn(out, period.key, kind)).find(
        (line) => line?.earlyDollars && line.earlyDeadline,
      );
      return dated
        ? { ...period, earlyDeadline: dated.earlyDeadline, earlyDeadlineTime: dated.earlyDeadlineTime }
        : period;
    });
    return { periods: withDeadlines, lines: out };
  });
  const [periodDrafts, setPeriodDrafts] = useState<PeriodDraft[]>(opening.periods);
  const [lines, setLines] = useState<LineDraft[]>(opening.lines);
  // Lines that were on file and were removed on screen, to delete on save.
  const [removed, setRemoved] = useState<LineDraft[]>([]);
  const [perHorse, setPerHorse] = useState(stallPerHorse);

  const [passes, setPasses] = useState<Record<string, PassDraft>>(() => {
    const keys = new Set(opening.periods.map((p) => p.key));
    const first = opening.periods[0];
    const out: Record<string, PassDraft> = {};
    for (const fee of passFees) {
      const key = fee.stall_period_id && keys.has(fee.stall_period_id) ? fee.stall_period_id : WHOLE_SHOW;
      if (!out[key]) out[key] = passFromFee(fee);
    }
    // An early move-in is a period's: a whole-show pass becomes the first
    // period's, unless it has been booked as it is.
    const whole = out[WHOLE_SHOW];
    if (first && whole && !out[first.key] && !whole.reservedCount) {
      out[first.key] = whole;
      delete out[WHOLE_SHOW];
    }
    return out;
  });
  // Passes on file whose move-in was removed, to delete on save.
  const [removedPasses, setRemovedPasses] = useState<PassDraft[]>([]);

  function blankLine(key: string, kind: StallKind, periodKey: string, periodName: string): LineDraft {
    return {
      key,
      feeId: null,
      code: null,
      label: autoName(kind, periodName),
      nameAuto: true,
      kind,
      periodKey,
      dollars: '',
      earlyDollars: '',
      earlyDeadline: '',
      earlyDeadlineTime: '',
      notes: '',
      horsesPerTack: '',
      reservedCount: 0,
      offered: false,
    };
  }

  const periodName = (key: string) => periodDrafts.find((p) => p.key === key)?.name ?? '';
  /** The saved id a key stands for: null for the whole show, and a value no
   *  saved row carries for a period not saved yet. */
  const periodIdOf = (key: string) =>
    key ? (periodDrafts.find((p) => p.key === key)?.id ?? `unsaved:${key}`) : null;

  // ── Stall prices ─────────────────────────────────────────────────────────

  /** The line holding a period's price for one stall type. Every period has
   *  one of each, from opening or from `addPeriod`. */
  const cellOf = (periodKey: string, kind: StallType) => cellIn(lines, periodKey, kind);
  const isCell = (line: LineDraft) =>
    isStallType(line.kind) && cellOf(line.periodKey, line.kind)?.key === line.key;
  /** Lines that are none of a period's three stall prices: a second line of
   *  one type in the same period, an add-on priced per stall, or a line sold
   *  for the whole show and booked before the show had periods. They are shown
   *  as they are, to reprice or stop. */
  const otherLines = lines.filter((line) => !isCell(line));

  /** A line as it is saved. A period's stall price is named for its type and
   *  period ("Box stall — Full show") and takes the period's reserve-by day
   *  when it has an early price; any other line is as the office typed it. */
  function effectiveLine(line: LineDraft): LineDraft {
    if (!isCell(line)) return line;
    const period = periodDrafts.find((p) => p.key === line.periodKey);
    if (!line.offered) return { ...line, label: autoName(line.kind, period?.name ?? ''), dollars: '', earlyDollars: '', earlyDeadline: '', earlyDeadlineTime: '' };
    const early = line.earlyDollars.trim() !== '';
    return {
      ...line,
      label: autoName(line.kind, period?.name ?? ''),
      earlyDeadline: early ? period?.earlyDeadline ?? '' : '',
      earlyDeadlineTime: early && period?.earlyDeadline ? period.earlyDeadlineTime : '',
    };
  }

  // ── Move-ins and their passes ────────────────────────────────────────────

  /** When a move-in opens: a period's own, or — for a whole-show pass booked
   *  before the periods — stalls opening, which is the first period's. */
  function moveInOf(key: string): { date: string; time: string } {
    if (key === WHOLE_SHOW) return earliestOf(periodDrafts) ?? { date: '', time: '' };
    const period = periodDrafts.find((p) => p.key === key);
    return { date: period?.moveInDate ?? '', time: period?.moveInTime ?? '' };
  }

  const passOf = (key: string): PassDraft => passes[key] ?? emptyPass();

  /** A pass's move-in as shown: its suggestion while untouched, else as typed.
   *  An hour on no day is not sent. */
  function passMoveInOf(key: string): { date: string; time: string } {
    const pass = passOf(key);
    if (pass.auto) {
      const ref = moveInOf(key);
      const suggested = defaultPassMoveIn(ref.date, ref.time);
      return { date: suggested?.date ?? '', time: suggested?.time ?? '' };
    }
    return { date: pass.typedDate, time: pass.typedDate ? pass.typedTime : '' };
  }

  /** Whether a pass would move its holders in no earlier than its move-in. */
  function passTooLate(key: string): boolean {
    const pass = passOf(key);
    if (!pass.offered) return false;
    const mine = passMoveInOf(key);
    const ref = moveInOf(key);
    return !passMovesInFirst(mine.date, mine.time, ref.date, ref.time);
  }

  /** When a pass's move-in ends, as it is sent: nothing without a start, and
   *  an hour only on a day. */
  function passEndOf(key: string): { date: string; time: string } {
    const pass = passOf(key);
    if (!passMoveInOf(key).date || !pass.endDate) return { date: '', time: '' };
    return { date: pass.endDate, time: pass.endTime };
  }

  /** Whether a pass's move-in would end before it starts. */
  function passEndsTooSoon(key: string): boolean {
    const pass = passOf(key);
    if (!pass.offered) return false;
    const start = passMoveInOf(key);
    const end = passEndOf(key);
    if (!end.date) return false;
    if (end.date !== start.date) return end.date < start.date;
    return Boolean(start.time && end.time && end.time <= start.time);
  }

  function setPass(key: string, patch: Partial<PassDraft>) {
    setPasses((prev) => ({ ...prev, [key]: { ...(prev[key] ?? emptyPass()), ...patch } }));
  }

  /** The office's own day or hour: the other half is kept as shown. */
  function editPassMoveIn(key: string, patch: { date?: string; time?: string }) {
    const shown = passMoveInOf(key);
    const typedDate = patch.date ?? shown.date;
    setPass(key, {
      auto: false,
      typedDate,
      typedTime: patch.time ?? timeForDay(typedDate, shown.time),
    });
  }

  /** The fees a pass draft keys to, so the dirty check reads what is on file. */
  const passFeeById = (id: string | null) => (id ? passFees.find((f) => f.id === id) : undefined);

  function passDirty(key: string): boolean {
    const pass = passOf(key);
    const fee = passFeeById(pass.feeId);
    if (!pass.offered) return Boolean(fee);
    // Saved this session and not yet back from the refresh: nothing to compare.
    if (!fee) return !pass.feeId;
    const shown = passMoveInOf(key);
    const end = passEndOf(key);
    return (
      pass.dollars.trim() !== centsToDollars(fee.amount_cents) ||
      pass.perExhibitor !== Boolean(fee.one_per_exhibitor) ||
      shown.date !== (fee.move_in_date ?? '') ||
      shown.time !== hhmm(fee.move_in_time) ||
      end.date !== (fee.move_in_end_date ?? '') ||
      (end.date ? end.time : '') !== hhmm(fee.move_in_end_time) ||
      pass.notes.trim() !== (fee.notes ?? '').trim() ||
      periodIdOf(key) !== (fee.stall_period_id ?? null)
    );
  }

  // ── Dirty ────────────────────────────────────────────────────────────────

  // A *Stalls open* day on file that the saved periods don't account for — set
  // before the show had periods, and outliving the last of them — is cleared
  // by sending the periods, even unchanged: the backend sets the day from them.
  const firstOnFile = earliestOf(periods.map(periodFromRow));
  const stallsOpenStale =
    stallsOpenDateOnFile !== (firstOnFile?.date ?? '') ||
    (stallsOpenDateOnFile ? stallsOpenTimeOnFile : '') !== (firstOnFile?.time ?? '');
  const periodsDirty =
    stallsOpenStale ||
    JSON.stringify(periodDrafts.map(periodPayload)) !==
      JSON.stringify(periods.map((p) => periodPayload(periodFromRow(p))));

  function lineDirty(draft: LineDraft): boolean {
    const line = effectiveLine(draft);
    if (!line.feeId) return line.dollars.trim() !== '';
    const fee = stallFees.find((f) => f.id === line.feeId);
    // Saved this session and not yet back from the refresh: nothing to compare.
    if (!fee) return false;
    const onFile = lineFromFee(fee, new Set(periodDrafts.map((p) => p.key)));
    // A reserve-by day means nothing without an early price.
    const onFileEarly = onFile.earlyDollars !== '';
    return (
      line.label !== onFile.label ||
      line.kind !== onFile.kind ||
      periodIdOf(line.periodKey) !== (fee.stall_period_id ?? null) ||
      line.dollars.trim() !== onFile.dollars ||
      line.earlyDollars !== onFile.earlyDollars ||
      line.earlyDeadline !== (onFileEarly ? onFile.earlyDeadline : '') ||
      line.earlyDeadlineTime !== (onFileEarly ? onFile.earlyDeadlineTime : '') ||
      line.notes !== onFile.notes ||
      (line.kind === 'tack' ? line.horsesPerTack : '') !== onFile.horsesPerTack
    );
  }

  const passKeys = [WHOLE_SHOW, ...periodDrafts.map((p) => p.key)];
  const dirty =
    perHorse !== stallPerHorse ||
    periodsDirty ||
    removed.length > 0 ||
    removedPasses.length > 0 ||
    lines.some(lineDirty) ||
    passKeys.some(passDirty);

  // ── Editing ──────────────────────────────────────────────────────────────

  function setLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) =>
      prev.map((line) => {
        if (line.key !== key) return line;
        const next = { ...line, ...patch };
        if ('label' in patch) next.nameAuto = false;
        else if (next.nameAuto && ('kind' in patch || 'periodKey' in patch)) {
          next.label = autoName(next.kind, periodName(next.periodKey));
        }
        return next;
      }),
    );
  }

  function removeLine(key: string) {
    const line = lines.find((l) => l.key === key);
    if (!line) return;
    if (line.feeId) setRemoved((prev) => [...prev, line]);
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  function setPeriod(key: string, patch: Partial<PeriodDraft>) {
    setPeriodDrafts((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
    if ('name' in patch) {
      setLines((prev) =>
        prev.map((line) =>
          line.nameAuto && line.periodKey === key
            ? { ...line, label: autoName(line.kind, patch.name ?? '') }
            : line,
        ),
      );
    }
  }

  function addPeriod() {
    const first = periodDrafts.length === 0;
    const key = newKey();
    // The first period is the whole show's, named and filled in; the office
    // names the others.
    const draft = first ? firstPeriod(key) : emptyPeriod(key, showStartDate, showEndDate);
    // The first period takes every stall and the pass sold for the whole show,
    // each unless it has been booked as it is.
    const joining = first ? lines.filter((line) => !line.periodKey && !line.reservedCount) : [];
    // A show bill states one reserve-by day for every stall ("prices double
    // after the class entry deadline"), so a period starts with the one its
    // stalls carry, or the period above's.
    const dated = joining.find((line) => line.earlyDollars && line.earlyDeadline);
    const above = periodDrafts[periodDrafts.length - 1];
    draft.earlyDeadline = dated?.earlyDeadline ?? above?.earlyDeadline ?? '';
    draft.earlyDeadlineTime = dated ? dated.earlyDeadlineTime : above?.earlyDeadlineTime ?? '';
    setPeriodDrafts((prev) => [...prev, draft]);
    // Then a price for each stall type it does not already have.
    setLines((prev) => {
      const next = first
        ? prev.map((line) => (line.periodKey || line.reservedCount ? line : { ...line, periodKey: key }))
        : [...prev];
      for (const kind of STALL_TYPES) {
        if (!cellIn(next, key, kind)) next.push(blankLine(`${key}-${kind}`, kind, key, draft.name));
      }
      return next;
    });
    if (first) {
      setPasses((prev) => {
        const whole = prev[WHOLE_SHOW];
        if (!whole || whole.reservedCount) return prev;
        const next = { ...prev, [key]: whole };
        delete next[WHOLE_SHOW];
        return next;
      });
    }
  }

  function removePeriod(key: string) {
    setPeriodDrafts((prev) => prev.filter((p) => p.key !== key));
    // Its stall prices go with it, as they are its own. None is booked — the
    // button is off while anything in the period is — so those on file are
    // deleted on save.
    const onFile = lines.filter((line) => line.periodKey === key && line.feeId);
    if (onFile.length) setRemoved((prev) => [...prev, ...onFile]);
    setLines((prev) => prev.filter((line) => line.periodKey !== key));
    // And its pass: an early move-in is always a period's.
    const pass = passes[key];
    setPasses((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (pass?.feeId) setRemovedPasses((prev) => [...prev, pass]);
  }

  /** Bookings in a period — its lines' and its pass's. The period cannot go
   *  while it has any, as a booked line's period cannot change (409). */
  const bookedIn = (key: string) =>
    lines.filter((line) => line.periodKey === key && line.reservedCount > 0).length +
    (passes[key]?.reservedCount ?? 0);

  // ── Saving ───────────────────────────────────────────────────────────────

  /** Writes the periods, the lines, then the passes. Returns whether
   *  everything was written; on a false the reason is already on screen. */
  async function save(setError: (message: string) => void): Promise<boolean> {
    for (const p of periodDrafts) {
      const name = p.name.trim();
      if (!name) {
        setError('Stall periods: every period needs a name.');
        return false;
      }
      if (!p.moveInDate || !p.moveOutDate) {
        setError(`${name}: pick its move-in and move-out days.`);
        return false;
      }
      if (p.moveOutDate < p.moveInDate) {
        setError(`${name}: move-out can't be before move-in.`);
        return false;
      }
    }
    for (const draft of lines) {
      if (isCell(draft) && draft.offered && draft.dollars.trim() === '') {
        setError(`${effectiveLine(draft).label}: enter a price, or untick it.`);
        return false;
      }
      if (draft.dollars.trim() === '' || (isCell(draft) && !draft.offered)) continue;
      const line = effectiveLine(draft);
      const name = line.label.trim();
      if (!name) {
        setError('Stalls: every charge per stall needs a name.');
        return false;
      }
      const price = Number.parseFloat(line.dollars);
      if (!Number.isFinite(price) || price < 0) {
        setError(`${name}: enter a price, or clear it to stop selling it.`);
        return false;
      }
      if (isCell(draft) && line.earlyDollars.trim() !== '' && !line.earlyDeadline) {
        setError(`${periodName(draft.periodKey).trim() || 'Stall period'}: early prices need a "reserve by" date.`);
        return false;
      }
      const early = earlyFields(line, dollarsToCents(line.dollars));
      if ('error' in early) {
        setError(`${name}: ${early.error}`);
        return false;
      }
      if (horsesPerTackOf(line) === undefined) {
        setError(`${name}: horses per tack stall is a whole number from 1 to 20, or blank for none.`);
        return false;
      }
    }
    for (const key of passKeys) {
      const pass = passOf(key);
      if (!pass.offered) continue;
      const where = key === WHOLE_SHOW ? 'Early Move-In Pass' : `${periodName(key) || 'Period'} early move-in`;
      const price = Number.parseFloat(pass.dollars);
      if (pass.dollars.trim() === '' || !Number.isFinite(price) || price < 0) {
        setError(`${where}: enter its price, or untick the box.`);
        return false;
      }
      if (passTooLate(key)) {
        setError(
          `${where}: pass holders have to move in before ${key === WHOLE_SHOW ? 'stalls open' : 'the period moves in'}.`,
        );
        return false;
      }
      if (passEndsTooSoon(key)) {
        setError(`${where}: the early move-in has to end after it starts.`);
        return false;
      }
    }

    // 1) Stall types and passes removed on screen, first: a period goes only
    //    once nothing in it is booked, which the backend checks against what is
    //    on file (409) — so a booked stall type removed along with its period
    //    has to be gone before the period is.
    for (const gone of [...removed, ...removedPasses]) {
      if (!gone.feeId) continue;
      const res = await fetch(`/api/shows/${showId}/fees/${gone.feeId}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204 && res.status !== 404) {
        const json = await res.json().catch(() => null);
        setError(errorMessage(json, `Failed to remove ${gone.label ?? 'a stall type'}.`));
        return false;
      }
    }
    setRemoved([]);
    setRemovedPasses([]);

    // 2) The periods, so a stall type or pass naming a new one can be given its
    //    id. The backend sets *Stalls open* to the first period's move-in, or
    //    clears it when there are none.
    const idByKey = new Map<string, string>();
    for (const p of periodDrafts) if (p.id) idByKey.set(p.key, p.id);
    if (periodsDirty) {
      const res = await fetch(`/api/shows/${showId}/stall-periods`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periods: periodDrafts.map(periodPayload) }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(json)) {
        setError(errorMessage(json, 'Failed to save the stall periods.'));
        return false;
      }
      // Returned in the order sent.
      const saved = json as StallPeriod[];
      periodDrafts.forEach((p, i) => saved[i] && idByKey.set(p.key, saved[i].id));
      setPeriodDrafts((prev) => prev.map((p, i) => ({ ...p, id: saved[i]?.id ?? p.id })));
    }

    // 3) Each stall price and other charge: a blank price stops selling it, as
    //    it always has.
    const used = new Set([...takenCodes, ...lines.map((l) => l.code ?? '')]);
    const settled: Record<string, { feeId: string | null; code: string | null }> = {};
    for (const draft of lines) {
      const line = effectiveLine(draft);
      const blank = line.dollars.trim() === '';
      if (!line.feeId && blank) continue;
      if (line.feeId && blank) {
        const res = await fetch(`/api/shows/${showId}/fees/${line.feeId}`, { method: 'DELETE' });
        if (!res.ok && res.status !== 204 && res.status !== 404) {
          const json = await res.json().catch(() => null);
          setError(errorMessage(json, `Failed to remove ${line.label}.`));
          return false;
        }
        settled[line.key] = { feeId: null, code: null };
        continue;
      }
      if (line.feeId && !lineDirty(draft)) continue;

      const cents = dollarsToCents(line.dollars);
      const payload = {
        label: line.label.trim(),
        amount_cents: cents,
        notes: line.notes.trim() || null,
        stall_kind: line.kind,
        stall_period_id: line.periodKey ? idByKey.get(line.periodKey) ?? null : null,
        horses_per_tack_stall: horsesPerTackOf(line) ?? null,
        ...(earlyFields(line, cents) as EarlyFields),
      };
      if (line.feeId) {
        const res = await fetch(`/api/shows/${showId}/fees/${line.feeId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => null);
          setError(errorMessage(json, `Failed to update ${line.label}.`));
          return false;
        }
      } else {
        // The show's first box or tie stall keeps the code the rest of the app
        // has always found it by; every other price gets its type and period:
        // `stall_tack_1a2b3c4d`.
        let code = 'stall';
        if (used.has(code) || !(line.kind === 'box' || line.kind === 'tie')) {
          const period = line.periodKey ? idByKey.get(line.periodKey)?.replace(/-/g, '').slice(0, 8) : undefined;
          const slug = line.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
          const base = (period ? `stall_${line.kind}_${period}` : `stall_${slug || 'line'}`).slice(0, 56);
          code = base;
          for (let n = 2; used.has(code) || RESERVED_CODES.has(code); n += 1) code = `${base}_${n}`;
        }
        used.add(code);
        const res = await fetch(`/api/shows/${showId}/fees`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, code, unit: 'per_stall' }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.id) {
          setError(errorMessage(json, `Failed to add ${line.label}.`));
          return false;
        }
        settled[line.key] = { feeId: json.id, code };
      }
    }
    // Remember what was created and removed, so a second save from this screen
    // patches the row the first one made instead of posting another.
    setLines((prev) =>
      prev.map((line) => (settled[line.key] ? { ...line, ...settled[line.key], nameAuto: false } : line)),
    );

    // 4) Each move-in's pass, after the stalls it is an extra on: fees list in
    //    the order they were created, so a show filling in both at once lists
    //    the stalls first at sign-up and on the bill.
    const settledPasses: Record<string, Partial<PassDraft>> = {};
    for (const key of passKeys) {
      const pass = passOf(key);
      const periodId = key === WHOLE_SHOW ? null : idByKey.get(key) ?? null;
      if (key !== WHOLE_SHOW && !periodId) continue;
      if (!pass.offered) {
        if (pass.feeId) {
          const res = await fetch(`/api/shows/${showId}/fees/${pass.feeId}`, { method: 'DELETE' });
          if (!res.ok && res.status !== 204 && res.status !== 404) {
            const json = await res.json().catch(() => null);
            setError(errorMessage(json, 'Failed to remove an Early Move-In Pass.'));
            return false;
          }
          settledPasses[key] = { feeId: null, code: null };
        }
        continue;
      }
      if (pass.feeId && !passDirty(key)) continue;
      const shown = passMoveInOf(key);
      const label =
        key === WHOLE_SHOW ? pass.label ?? 'Early Move-In Pass' : `Early Move-In Pass — ${periodName(key).trim()}`;
      const payload = {
        label,
        amount_cents: dollarsToCents(pass.dollars),
        one_per_exhibitor: pass.perExhibitor,
        stall_kind: 'add_on',
        stall_period_id: periodId,
        move_in_date: shown.date || null,
        move_in_time: shown.date ? shown.time || null : null,
        move_in_end_date: passEndOf(key).date || null,
        move_in_end_time: passEndOf(key).date ? passEndOf(key).time || null : null,
        notes: pass.notes.trim() || null,
      };
      // The whole show's pass answers to `early_move_in` (an older
      // `early_arrival_stall` takes it on its first save here); a period's to
      // `early_move_in_` and the start of the period's id.
      const code =
        key === WHOLE_SHOW ? EARLY_MOVE_IN_CODE : `${EARLY_MOVE_IN_PREFIX}${periodId!.replace(/-/g, '').slice(0, 8)}`;
      if (pass.feeId) {
        const res = await fetch(`/api/shows/${showId}/fees/${pass.feeId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, ...(pass.code !== code ? { code } : {}) }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => null);
          setError(errorMessage(json, `Failed to update ${label}.`));
          return false;
        }
        settledPasses[key] = { code };
      } else {
        const res = await fetch(`/api/shows/${showId}/fees`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, code, unit: 'per_stall' }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.id) {
          setError(errorMessage(json, `Failed to add ${label}.`));
          return false;
        }
        settledPasses[key] = { feeId: json.id, code };
      }
    }
    setPasses((prev) => {
      const next = { ...prev };
      for (const [key, patch] of Object.entries(settledPasses)) next[key] = { ...(next[key] ?? emptyPass()), ...patch };
      return next;
    });
    return true;
  }

  return {
    periods: periodDrafts,
    lines,
    removed,
    perHorse,
    setPerHorse,
    dirty,
    save,
    setLine,
    removeLine,
    cellOf,
    otherLines,
    setPeriod,
    addPeriod,
    removePeriod,
    bookedIn,
    passOf,
    setPass,
    passMoveInOf,
    editPassMoveIn,
    passTooLate,
    passEndOf,
    passEndsTooSoon,
    moveInOf,
    showStartDate,
    showEndDate,
  };
}

const INPUT = 'w-full border rounded px-3 py-2';
const LABEL = 'block text-xs mb-1';

/**
 * One move-in's Early Move-In Pass: a tick, a price, how it is priced, and when
 * its holders move in — filled in, and checked against the move-in it beats.
 */
function PassFields({
  editor,
  passKey,
  heading,
  beats,
}: {
  editor: StallsEditor;
  /** The period's key, or '' for the whole show. */
  passKey: string;
  heading: string;
  /** What the pass moves holders in ahead of, for the error: "stalls open". */
  beats: string;
}) {
  const pass = editor.passOf(passKey);
  const shown = editor.passMoveInOf(passKey);
  const tooLate = editor.passTooLate(passKey);
  const ref = editor.moveInOf(passKey);
  const refText = formatStallsOpen(ref.date || null, ref.time || null);
  const end = editor.passEndOf(passKey);
  const endsTooSoon = editor.passEndsTooSoon(passKey);
  const preview = passMoveIn({
    move_in_date: shown.date || null,
    move_in_time: shown.time || null,
    move_in_end_date: end.date || null,
    move_in_end_time: end.time || null,
  });
  const basis = pass.perExhibitor ? 'per exhibitor' : unitLabel(pass.unit);
  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2 text-sm" style={{ color: COLORS.text }}>
        <input
          type="checkbox"
          checked={pass.offered}
          onChange={(e) => editor.setPass(passKey, { offered: e.target.checked })}
          className="mt-0.5"
        />
        <span>
          <strong>{heading}</strong>{' '}
          <span style={{ color: COLORS.muted }}>Option for exhibitors to purchase an early move-in.</span>
        </span>
      </label>
      {pass.offered && (
        <div className="ml-6 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-[9rem_10rem] gap-3 items-end">
            <label className="block">
              <span className={LABEL} style={{ color: COLORS.muted }}>
                $ {basis}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={pass.dollars}
                onChange={(e) => editor.setPass(passKey, { dollars: e.target.value })}
                className={INPUT}
                style={{ borderColor: COLORS.border }}
                placeholder="e.g. 35.00"
                aria-label={`${heading} — price ${basis}`}
              />
            </label>
            {/* The show's choice (migration 196): somebody moving four stalls
                in early buys four passes, or one covers them all. */}
            <label className="block">
              <span className={LABEL} style={{ color: COLORS.muted }}>
                Priced
              </span>
              <select
                value={pass.perExhibitor ? 'exhibitor' : 'stall'}
                onChange={(e) => editor.setPass(passKey, { perExhibitor: e.target.value === 'exhibitor' })}
                className={INPUT}
                style={{ borderColor: COLORS.border }}
                aria-label={`${heading} — priced per`}
              >
                <option value="stall">Per stall</option>
                <option value="exhibitor">Per exhibitor</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            <div>
              <span className={LABEL} style={{ color: COLORS.muted }}>
                Pass holders move in from (optional)
              </span>
              <div className="flex flex-wrap gap-2">
                <input
                  type="date"
                  value={shown.date}
                  max={ref.date || editor.showEndDate}
                  onChange={(e) => editor.editPassMoveIn(passKey, { date: e.target.value })}
                  className="min-w-[9.5rem] flex-1 border rounded px-3 py-2"
                  style={{ borderColor: tooLate ? 'var(--error)' : COLORS.border }}
                  aria-invalid={tooLate}
                  aria-label={`${heading} — move-in day`}
                />
                <input
                  type="time"
                  value={shown.time}
                  disabled={!shown.date}
                  title={shown.date ? 'Optional' : 'Pick the day first.'}
                  onChange={(e) => editor.editPassMoveIn(passKey, { time: e.target.value })}
                  className="w-32 border rounded px-3 py-2 disabled:opacity-50"
                  style={{ borderColor: COLORS.border }}
                  aria-label={`${heading} — move-in time`}
                />
              </div>
            </div>
            {/* When the early window closes (migration 203) — WSCA's priority
                pass moves trailers in "from 2 PM to 4 PM". Only with a start. */}
            <div>
              <span className={LABEL} style={{ color: COLORS.muted }}>
                Until (optional)
              </span>
              <div className="flex flex-wrap gap-2">
                <input
                  type="date"
                  value={end.date || pass.endDate}
                  min={shown.date || undefined}
                  disabled={!shown.date}
                  title={shown.date ? 'Optional' : 'Set when pass holders move in from first.'}
                  onChange={(e) => editor.setPass(passKey, { endDate: e.target.value, ...(e.target.value ? {} : { endTime: '' }) })}
                  className="min-w-[9.5rem] flex-1 border rounded px-3 py-2 disabled:opacity-50"
                  style={{ borderColor: endsTooSoon ? 'var(--error)' : COLORS.border }}
                  aria-invalid={endsTooSoon}
                  aria-label={`${heading} — move-in ends day`}
                />
                <input
                  type="time"
                  value={end.date ? end.time : ''}
                  disabled={!end.date}
                  title={end.date ? 'Optional' : 'Pick the day first.'}
                  onChange={(e) => editor.setPass(passKey, { endTime: e.target.value })}
                  className="w-32 border rounded px-3 py-2 disabled:opacity-50"
                  style={{ borderColor: endsTooSoon ? 'var(--error)' : COLORS.border }}
                  aria-label={`${heading} — move-in ends time`}
                />
              </div>
            </div>
          </div>
          <label className="block">
            <span className={LABEL} style={{ color: COLORS.muted }}>
              Notes (optional)
            </span>
            <input
              type="text"
              value={pass.notes}
              maxLength={500}
              onChange={(e) => editor.setPass(passKey, { notes: e.target.value })}
              className={INPUT}
              style={{ borderColor: COLORS.border }}
              placeholder="e.g. Limited passes, first come first served. One trailer per pass."
              aria-label={`${heading} — notes`}
            />
          </label>
          {pass.unit !== 'per_stall' && (
            <p className="text-xs" style={{ color: COLORS.muted }}>
              Charged {unitLabel(pass.unit)} on the boarding fee schedule.
            </p>
          )}
          {tooLate ? (
            <p className="text-xs" style={{ color: 'var(--error-strong)' }} role="alert">
              That&apos;s not before {beats}
              {refText ? ` (${refText})` : ''}. Pass holders have to move in earlier.
            </p>
          ) : endsTooSoon ? (
            <p className="text-xs" style={{ color: 'var(--error-strong)' }} role="alert">
              The early move-in has to end after it starts.
            </p>
          ) : preview ? (
            <p className="text-xs" style={{ color: COLORS.muted }}>
              Exhibitors will see the following when registering:{' '}
              <strong style={{ color: COLORS.text }}>Early Move-In Pass holders move in from {preview}</strong>
            </p>
          ) : null}
        </div>
      )}
      {!pass.offered && pass.reservedCount > 0 && (
        <p className="text-xs ml-6" style={{ color: 'var(--error-strong)' }} role="alert">
          {pass.reservedCount} exhibitor{pass.reservedCount === 1 ? ' has' : 's have'} booked a pass.
          Saving takes it off {pass.reservedCount === 1 ? 'their bill' : 'their bills'}.
        </p>
      )}
    </div>
  );
}

/** A ticked stall type's fields: its price, its early price, its notes. */
const PRICE_FIELDS = 'grid grid-cols-2 sm:grid-cols-[8rem_8rem_minmax(0,1fr)] gap-x-3 gap-y-2 items-end';

/**
 * A stall period's prices: a tick box for each of its box, tie and tack
 * stalls, and only once one is ticked, its price per stall, an optional early
 * price and notes — then one reserve-by day for the period's early prices and
 * the horse stalls a tack stall needs. Unticked is not offered. Exhibitors
 * book how many of each they want when they register.
 */
function StallPrices({ editor, period }: { editor: StallsEditor; period: PeriodDraft }) {
  const name = period.name.trim() || 'this period';
  const cells = STALL_TYPES.map((kind) => editor.cellOf(period.key, kind)).filter(
    (line): line is LineDraft => Boolean(line),
  );
  const tack = editor.cellOf(period.key, 'tack');
  const anyEarly = cells.some((line) => line.offered && line.earlyDollars.trim() !== '');
  const deadlineMissing = anyEarly && !period.earlyDeadline;
  return (
    <div className="pt-2 border-t space-y-3" style={{ borderColor: 'var(--border-subtle)' }}>
      <div>
        <h4 className="text-sm font-semibold" style={{ color: COLORS.text }}>
          Stall prices
        </h4>
        <p className="text-xs mt-0.5" style={{ color: COLORS.muted }}>
          Tick each type of stall you offer for {name} and price it per stall. Exhibitors choose
          how many of each they want when they register.
        </p>
      </div>

      <div className="space-y-3">
        {cells.map((line) => {
          const type = STALL_TYPE_LABEL[line.kind as StallType];
          const booked = line.reservedCount;
          return (
            <div key={line.key} className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium" style={{ color: COLORS.text }}>
                <input
                  type="checkbox"
                  checked={line.offered}
                  onChange={(e) => editor.setLine(line.key, { offered: e.target.checked })}
                  aria-label={`Offer ${type.toLowerCase()}s for ${name}`}
                />
                {type}
              </label>
              {line.offered && (
                <div className={`ml-6 ${PRICE_FIELDS}`}>
                  <label className="block">
                    <span className={LABEL} style={{ color: COLORS.muted }}>
                      $ per stall
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={line.dollars}
                      onChange={(e) => editor.setLine(line.key, { dollars: e.target.value })}
                      className={INPUT}
                      style={{ borderColor: COLORS.border }}
                      placeholder="e.g. 130.00"
                      aria-label={`${type} — ${name} — price per stall`}
                    />
                  </label>
                  <label className="block">
                    <span className={LABEL} style={{ color: COLORS.muted }}>
                      Early price (optional)
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={line.earlyDollars}
                      onChange={(e) => editor.setLine(line.key, { earlyDollars: e.target.value })}
                      className={INPUT}
                      style={{ borderColor: COLORS.border }}
                      placeholder="e.g. 65.00"
                      title="Charged instead if they reserve by the date below."
                      aria-label={`${type} — ${name} — early price`}
                    />
                  </label>
                  <label className="block col-span-2 sm:col-span-1">
                    <span className={LABEL} style={{ color: COLORS.muted }}>
                      Notes (optional)
                    </span>
                    <input
                      type="text"
                      maxLength={NOTES_MAX}
                      value={line.notes}
                      onChange={(e) => editor.setLine(line.key, { notes: oneParagraph(e.target.value) })}
                      className={INPUT}
                      style={{ borderColor: COLORS.border }}
                      aria-label={`${type} — ${name} — notes`}
                    />
                  </label>
                </div>
              )}
              {line.feeId && booked > 0 && !line.offered && (
                <p className="text-xs ml-6" style={{ color: 'var(--error-strong)' }} role="alert">
                  {booked} exhibitor{booked === 1 ? ' has' : 's have'} booked {type.toLowerCase()}s for{' '}
                  {name}. Saving takes them off {booked === 1 ? 'their bill' : 'their bills'}.
                </p>
              )}
            </div>
          );
        })}
      </div>

      {(anyEarly || (tack?.offered ?? false)) && (
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          {anyEarly && (
            <div>
              <span className={LABEL} style={{ color: COLORS.muted }}>
                Early prices gauranteed if reserved by
              </span>
              <div className="flex flex-wrap gap-2">
                <input
                  type="date"
                  value={period.earlyDeadline}
                  onChange={(e) =>
                    editor.setPeriod(period.key, {
                      earlyDeadline: e.target.value,
                      earlyDeadlineTime: timeForDay(e.target.value, period.earlyDeadlineTime),
                    })
                  }
                  className="min-w-[9.5rem] border rounded px-3 py-2"
                  style={{ borderColor: deadlineMissing ? 'var(--error)' : COLORS.border }}
                  aria-invalid={deadlineMissing}
                  aria-label={`${name} — early prices reserve-by date`}
                />
                <input
                  type="time"
                  value={period.earlyDeadlineTime}
                  disabled={!period.earlyDeadline}
                  title={period.earlyDeadline ? 'Optional' : 'Pick the reserve-by date first.'}
                  onChange={(e) => editor.setPeriod(period.key, { earlyDeadlineTime: e.target.value })}
                  className="w-32 border rounded px-3 py-2 disabled:opacity-50"
                  style={{ borderColor: COLORS.border }}
                  aria-label={`${name} — early prices reserve-by time`}
                />
              </div>
            </div>
          )}
          {tack?.offered && (
            <label
              className="block"
              title="Flagged, never refused: an exhibitor booking a tack stall with fewer horse stalls in the same period is told so, and so is the desk."
            >
              <span className={LABEL} style={{ color: COLORS.muted }}>
                Horse stalls required per tack stall
              </span>
              <input
                type="number"
                min={1}
                max={20}
                value={tack.horsesPerTack}
                onChange={(e) => editor.setLine(tack.key, { horsesPerTack: e.target.value })}
                className="w-32 border rounded px-3 py-2"
                style={{ borderColor: COLORS.border }}
                placeholder="No minimum"
                aria-label={`${name} — horse stalls required per tack stall`}
              />
            </label>
          )}
        </div>
      )}
      {deadlineMissing && (
        <p className="text-xs" style={{ color: 'var(--error-strong)' }} role="alert">
          Early prices need a reserve-by date.
        </p>
      )}
    </div>
  );
}

/**
 * One other charge per stall — none of a period's three stall prices — as it
 * is on file: its name and kind, its price and early rate, a tack stall's horse
 * minimum, and its notes, to reprice or stop.
 */
function StallTypeFields({ editor, line, where }: { editor: StallsEditor; line: LineDraft; where: string }) {
  const booked = line.reservedCount;
  const notesLeft = NOTES_MAX - line.notes.length;
  return (
    <div
      className="rounded border p-3 space-y-3"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <p className="text-xs" style={{ color: COLORS.muted }}>
        {where}
        {booked > 0 && ` · ${booked} booked`}
      </p>
      <div className="grid gap-3 items-end sm:grid-cols-[minmax(0,1fr)_11rem_auto]">
        <label className="block">
          <span className={LABEL} style={{ color: COLORS.muted }}>Name</span>
          <input
            type="text"
            value={line.label}
            maxLength={200}
            onChange={(e) => editor.setLine(line.key, { label: e.target.value })}
            className={INPUT}
            style={{ borderColor: COLORS.border }}
            placeholder="e.g. Box stall"
          />
        </label>
        <label className="block">
          <span className={LABEL} style={{ color: COLORS.muted }}>Kind</span>
          <select
            value={line.kind}
            onChange={(e) => editor.setLine(line.key, { kind: e.target.value as StallKind })}
            className={INPUT}
            style={{ borderColor: COLORS.border }}
            title={STALL_KIND_OPTIONS.find((o) => o.value === line.kind)?.hint}
          >
            {STALL_KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => editor.removeLine(line.key)}
          className="text-sm underline py-2 justify-self-start"
          style={{ color: COLORS.muted }}
        >
          Remove
        </button>
      </div>

      <div className="grid gap-x-6 gap-y-3 md:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className={`${PRICE_COLS} items-end`}>
            <label className="block">
              <span className={LABEL} style={{ color: COLORS.muted }}>$ per stall</span>
              <input
                type="text"
                inputMode="decimal"
                value={line.dollars}
                onChange={(e) => editor.setLine(line.key, { dollars: e.target.value })}
                className={INPUT}
                style={{ borderColor: COLORS.border }}
                placeholder="e.g. 130.00"
                aria-label={`${line.label} — amount per stall`}
              />
            </label>
            {line.kind === 'tack' && (
              <label
                className="block"
                title="Flagged, never refused: an exhibitor booking this tack stall with fewer horse stalls in the same period is told so, and so is the desk."
              >
                <span className={LABEL} style={{ color: COLORS.muted }}>
                  Horse stalls required per tack stall
                </span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={line.horsesPerTack}
                  onChange={(e) => editor.setLine(line.key, { horsesPerTack: e.target.value })}
                  className={INPUT}
                  style={{ borderColor: COLORS.border }}
                  placeholder="no minimum"
                  aria-label={`${line.label} — horse stalls required per tack stall`}
                />
              </label>
            )}
          </div>
          <div role="group" aria-label={`${line.label} — early rate`}>
            <p className="text-xs mb-1.5" style={{ color: COLORS.text }}>
              Early rate{' '}
              <span style={{ color: 'var(--text-dimmed)' }}>
                (optional — cheaper if they reserve by the date)
              </span>
            </p>
            <div className={`${PRICE_COLS} items-end`}>
              <label className="block">
                <span className={LABEL} style={{ color: COLORS.muted }}>Early amount ($)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={line.earlyDollars}
                  onChange={(e) => editor.setLine(line.key, { earlyDollars: e.target.value })}
                  className={INPUT}
                  style={{ borderColor: COLORS.border }}
                  placeholder="e.g. 65.00"
                  aria-label={`${line.label} — early rate amount`}
                />
              </label>
              <div>
                <span className={LABEL} style={{ color: COLORS.muted }}>Reserve by</span>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="date"
                    value={line.earlyDeadline}
                    onChange={(e) =>
                      editor.setLine(line.key, {
                        earlyDeadline: e.target.value,
                        earlyDeadlineTime: timeForDay(e.target.value, line.earlyDeadlineTime),
                      })
                    }
                    className="min-w-[9.5rem] flex-1 border rounded px-3 py-2"
                    style={{ borderColor: COLORS.border }}
                    aria-label={`${line.label} — early rate deadline`}
                  />
                  <input
                    type="time"
                    value={line.earlyDeadlineTime}
                    disabled={!line.earlyDeadline}
                    title={line.earlyDeadline ? 'Optional' : 'Pick the reserve-by date first.'}
                    onChange={(e) => editor.setLine(line.key, { earlyDeadlineTime: e.target.value })}
                    className="w-32 border rounded px-3 py-2 disabled:opacity-50"
                    style={{ borderColor: COLORS.border }}
                    aria-label={`${line.label} — early rate deadline time`}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <label className="flex flex-col">
          <span className="flex justify-between gap-2 text-xs mb-1" style={{ color: COLORS.muted }}>
            <span>Notes (optional)</span>
            {notesLeft <= 100 && <span>{notesLeft} characters left</span>}
          </span>
          <textarea
            rows={3}
            maxLength={NOTES_MAX}
            value={line.notes}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault();
            }}
            onChange={(e) => editor.setLine(line.key, { notes: oneParagraph(e.target.value) })}
            className="w-full flex-1 min-h-[5.75rem] border rounded px-3 py-2 resize-y"
            style={{ borderColor: COLORS.border, fieldSizing: 'content' }}
            aria-label={`${line.label} — notes`}
          />
        </label>
      </div>

      {line.feeId && booked > 0 && line.dollars.trim() === '' && (
        <p className="text-xs" style={{ color: 'var(--error-strong)' }} role="alert">
          {booked} exhibitor{booked === 1 ? ' has' : 's have'} booked this charge. Saving
          takes it off {booked === 1 ? 'their bill' : 'their bills'}.
        </p>
      )}
    </div>
  );
}

export function StallsCard({ editor }: { editor: StallsEditor }) {
  const { periods, otherLines } = editor;
  const removedBooked = editor.removed.filter((line) => line.reservedCount > 0);
  // A whole-show pass booked before the show had periods keeps what was bought.
  const wholeShowPass = Boolean(editor.passOf(WHOLE_SHOW).feeId);

  // Periods folded down to one line, by key. Open until the office folds one;
  // what is in it stays in the editor, so nothing typed is lost.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** A folded period in one line: when it moves in and out, the stall types it
   *  offers at their prices, and its early move-in. */
  function summaryOf(p: PeriodDraft): string {
    const window = p.moveInDate && p.moveOutDate ? periodWindow(asPeriod(p)) : '';
    const stalls = STALL_TYPES.map((kind) => editor.cellOf(p.key, kind))
      .filter((line): line is LineDraft => Boolean(line?.offered))
      .map((line) => {
        const price = line.dollars.trim();
        return `${STALL_TYPE_LABEL[line.kind as StallType]} ${price ? `$${price}` : '(no price)'}`;
      });
    const pass = editor.passOf(p.key);
    const price = pass.dollars.trim();
    const early = pass.offered
      ? `Early move-in ${price ? `$${price} ${pass.perExhibitor ? 'per exhibitor' : 'per stall'}` : '(no price)'}`
      : '';
    return [window, stalls.length ? stalls.join(', ') : 'No stalls offered', early].filter(Boolean).join(' · ');
  }

  /** What a folded period would stop the save over, so it is not hidden. */
  function problemOf(p: PeriodDraft): string | null {
    if (!p.name.trim()) return 'Needs a name.';
    if (!p.moveInDate || !p.moveOutDate) return 'Needs its move-in and move-out days.';
    if (p.moveOutDate < p.moveInDate) return 'Move-out is before move-in.';
    const cells = STALL_TYPES.map((kind) => editor.cellOf(p.key, kind)).filter(
      (line): line is LineDraft => Boolean(line),
    );
    if (cells.some((line) => line.offered && !line.dollars.trim())) return 'A ticked stall type needs a price.';
    if (cells.some((line) => line.offered && line.earlyDollars.trim()) && !p.earlyDeadline) {
      return 'Early prices need a reserve-by date.';
    }
    const pass = editor.passOf(p.key);
    if (pass.offered && !pass.dollars.trim()) return 'Early move-in needs a price.';
    if (editor.passTooLate(p.key)) return 'Early move-in has to be before the period moves in.';
    if (editor.passEndsTooSoon(p.key)) return 'Early move-in has to end after it starts.';
    return null;
  }

  return (
    <section
      className="p-4 rounded-lg border space-y-5"
      style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
      aria-labelledby="stalls-heading"
    >
      <div>
        <h2 id="stalls-heading" className="text-base font-semibold" style={{ color: COLORS.text }}>
          Stalls &amp; move-in
        </h2>
        <p className="text-xs mt-0.5" style={{ color: COLORS.muted }}>
          Setup Stall configuration and dates below
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm" style={{ color: COLORS.text }}>
        <input
          type="checkbox"
          checked={editor.perHorse}
          onChange={(e) => editor.setPerHorse(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <strong>Every horse entered needs its own stall.</strong>{' '}
          <span style={{ color: COLORS.muted }}>
            GaitDesk will alert you if an exhibitor has more horses than stalls reserved.
          </span>
        </span>
      </label>

      {/* Everything is set by period: its move-in and move-out, the stall
          types it sells and its early move-in. */}
      <div className="space-y-3 pt-4 border-t" style={{ borderColor: COLORS.border }}>
        <div>
          <h3 className="text-sm font-semibold" style={{ color: COLORS.text }}>
            Stall periods
          </h3>
          <p className="text-xs mt-0.5" style={{ color: COLORS.muted }}>
            Stall periods allow you to setup different move-in/move-out dates times if your show
            requires it. To add more than one Stall move-in/move-out configuration, click
            &quot;+Add a stall period&quot; and give each Stall period a name, date, time, and Early
            paid move-in (optional)
          </p>
        </div>

        {periods.length === 0 && (
          <p className="text-sm" style={{ color: COLORS.muted }}>
            No stall periods yet. Add one to set when exhibitors move in and out and the stall types
            you sell.
          </p>
        )}

        {periods.map((p) => {
          const booked = editor.bookedIn(p.key);
          const preview = p.moveInDate && p.moveOutDate ? periodWindow(asPeriod(p)) : '';
          const backwards = Boolean(p.moveInDate && p.moveOutDate && p.moveOutDate < p.moveInDate);
          const label = p.name.trim() || 'this period';
          const isCollapsed = collapsed.has(p.key);
          const problem = isCollapsed ? problemOf(p) : null;
          return (
            <div
              key={p.key}
              className="rounded border p-3 space-y-3"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              {/* Folds the period to one line once it is set up; the name
                  and that line stay, so the list can still be read. */}
              <button
                type="button"
                onClick={() => toggle(p.key)}
                aria-expanded={!isCollapsed}
                aria-controls={`stall-period-${p.key}`}
                className="w-full flex items-start justify-between gap-3 text-left"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold" style={{ color: COLORS.text }}>
                    {p.name.trim() || 'Unnamed period'}
                  </span>
                  {isCollapsed && (
                    <span className="block text-xs mt-0.5" style={{ color: COLORS.muted }}>
                      {summaryOf(p)}
                    </span>
                  )}
                  {problem && (
                    <span className="block text-xs mt-0.5" style={{ color: 'var(--error-strong)' }}>
                      {problem}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-sm underline" style={{ color: COLORS.muted }}>
                  {isCollapsed ? 'Expand' : 'Collapse'}
                </span>
              </button>
              {!isCollapsed && (
                <div id={`stall-period-${p.key}`} className="space-y-3">
                  {p.carried && !p.id && (
                    <p className="text-xs" style={{ color: COLORS.muted }}>
                      {p.carried === 'stalls-open'
                        ? 'Filled in from when this show said its stalls open.'
                        : 'Added to hold the stalls this show already sells, moving in the day before the show.'}{' '}
                      Check the days — it saves with the rest of this step.
                    </p>
                  )}
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] items-end">
                    <label className="block">
                      <span className={LABEL} style={{ color: COLORS.muted }}>Name</span>
                      <input
                        type="text"
                        value={p.name}
                        maxLength={60}
                        onChange={(e) => editor.setPeriod(p.key, { name: e.target.value })}
                        className={INPUT}
                        style={{ borderColor: COLORS.border }}
                        placeholder="e.g. Pleasure"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => editor.removePeriod(p.key)}
                      disabled={booked > 0}
                      title={
                        booked > 0
                          ? 'Exhibitors have booked stalls or passes in this period. Stop selling those first.'
                          : undefined
                      }
                      className="text-sm underline py-2 justify-self-start disabled:opacity-50"
                      style={{ color: COLORS.muted }}
                    >
                      Remove period
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <fieldset>
                      <legend className={LABEL} style={{ color: COLORS.muted }}>Move in</legend>
                      <div className="flex gap-2">
                        <input
                          type="date"
                          value={p.moveInDate}
                          max={editor.showEndDate}
                          onChange={(e) =>
                            editor.setPeriod(p.key, {
                              moveInDate: e.target.value,
                              moveInTime: timeForDay(e.target.value, p.moveInTime),
                            })
                          }
                          className="min-w-0 flex-1 border rounded px-3 py-2"
                          style={{ borderColor: COLORS.border }}
                          aria-label={`${p.name || 'Period'} — move-in day`}
                        />
                        <input
                          type="time"
                          value={p.moveInTime}
                          onChange={(e) => editor.setPeriod(p.key, { moveInTime: e.target.value })}
                          className="w-32 border rounded px-3 py-2"
                          style={{ borderColor: COLORS.border }}
                          title="Optional"
                          aria-label={`${p.name || 'Period'} — move-in time`}
                        />
                      </div>
                    </fieldset>
                    <fieldset>
                      <legend className={LABEL} style={{ color: COLORS.muted }}>Move out</legend>
                      <div className="flex gap-2">
                        <input
                          type="date"
                          value={p.moveOutDate}
                          min={editor.showStartDate}
                          onChange={(e) =>
                            editor.setPeriod(p.key, {
                              moveOutDate: e.target.value,
                              moveOutTime: timeForDay(e.target.value, p.moveOutTime),
                            })
                          }
                          className="min-w-0 flex-1 border rounded px-3 py-2"
                          style={{ borderColor: backwards ? 'var(--error)' : COLORS.border }}
                          aria-invalid={backwards}
                          aria-label={`${p.name || 'Period'} — move-out day`}
                        />
                        <input
                          type="time"
                          value={p.moveOutTime}
                          onChange={(e) => editor.setPeriod(p.key, { moveOutTime: e.target.value })}
                          className="w-32 border rounded px-3 py-2"
                          style={{ borderColor: COLORS.border }}
                          title="Optional"
                          aria-label={`${p.name || 'Period'} — move-out time`}
                        />
                      </div>
                    </fieldset>
                  </div>
                  <label className="block">
                    <span className={LABEL} style={{ color: COLORS.muted }}>
                      Move-out note (optional)
                    </span>
                    <input
                      type="text"
                      value={p.moveOutNote}
                      maxLength={200}
                      onChange={(e) => editor.setPeriod(p.key, { moveOutNote: e.target.value })}
                      className={INPUT}
                      style={{ borderColor: COLORS.border }}
                      placeholder="e.g. 1 hour after your last class"
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="flex justify-between gap-2 text-xs mb-1" style={{ color: COLORS.muted }}>
                      <span>Move-in notes for exhibitors (optional)</span>
                      {MOVE_IN_NOTES_MAX - p.moveInNotes.length <= 200 && (
                        <span>{MOVE_IN_NOTES_MAX - p.moveInNotes.length} characters left</span>
                      )}
                    </span>
                    <textarea
                      rows={3}
                      maxLength={MOVE_IN_NOTES_MAX}
                      value={p.moveInNotes}
                      onChange={(e) => editor.setPeriod(p.key, { moveInNotes: e.target.value })}
                      className="w-full min-h-[5.75rem] border rounded px-3 py-2 resize-y"
                      style={{ borderColor: COLORS.border, fieldSizing: 'content' }}
                      placeholder="e.g. No unloading in the parking lot while you wait in line — unload between the barns. Stall assignments are posted at the barn office at 4 PM, not before."
                      aria-label={`${label} — move-in notes for exhibitors`}
                    />
                  </label>
                  {backwards ? (
                    <p className="text-xs" style={{ color: 'var(--error-strong)' }} role="alert">
                      Move-out is before move-in.
                    </p>
                  ) : preview ? (
                    <p className="text-xs" style={{ color: COLORS.muted }}>
                      Exhibitors will see the following when registering:{' '}
                      <strong style={{ color: COLORS.text }}>{preview}</strong>
                    </p>
                  ) : null}
                  <StallPrices editor={editor} period={p} />
                  {/* Off until the office ticks it: a later period's stalls may be
                      the earlier period's, still occupied, and only the office
                      knows which. */}
                  <div className="pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <PassFields
                      editor={editor}
                      passKey={p.key}
                      heading={`Offer early move-in for ${label}.`}
                      beats={`${label} moves in`}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={editor.addPeriod}
          className="text-sm underline"
          style={{ color: COLORS.text }}
        >
          + Add a stall period
        </button>

        {/* What priced per stall is none of a period's box, tie or tack
            prices — a second price for one type, a charge per stall that is
            not a stall, or one booked for the whole show before the show had
            periods. Shown as it is, to reprice or stop, never added to. */}
        {(otherLines.length > 0 || wholeShowPass) && (
          <div className="rounded border p-3 space-y-3" style={{ borderColor: 'var(--border-subtle)' }}>
            <div>
              <h4 className="text-sm font-semibold" style={{ color: COLORS.text }}>
                Other charges per stall
              </h4>
              <p className="text-xs mt-0.5" style={{ color: COLORS.muted }}>
                Already on this show, and not one of a period&apos;s box, tie or tack stall prices:
                a second price for the same type of stall, a charge per stall that isn&apos;t a
                stall, or one booked for the whole show before it had stall periods. Reprice or
                stop selling them here.
              </p>
            </div>
            {otherLines.map((line) => (
              <StallTypeFields
                key={line.key}
                editor={editor}
                line={line}
                where={
                  line.periodKey
                    ? `Sold for ${periods.find((p) => p.key === line.periodKey)?.name.trim() || 'a stall period'}`
                    : 'Sold for the whole show'
                }
              />
            ))}
            {wholeShowPass && (
              <PassFields
                editor={editor}
                passKey={WHOLE_SHOW}
                heading="Early Move-In Pass for the whole show."
                beats="stalls open"
              />
            )}
          </div>
        )}

        {removedBooked.length > 0 && (
          <p className="text-xs" style={{ color: 'var(--error-strong)' }} role="alert">
            {removedBooked.map((line) => line.label).join(', ')}:{' '}
            {removedBooked.reduce((n, line) => n + line.reservedCount, 0)} booking
            {removedBooked.reduce((n, line) => n + line.reservedCount, 0) === 1 ? '' : 's'} will come
            off exhibitors&apos; bills when you save.
          </p>
        )}

      </div>

    </section>
  );
}
