/**
 * What the sign-up form says beside the arrival and departure days, worked out
 * from the stalls the exhibitor has booked (migrations 194–196).
 *
 * A booked stall opens to its holder at its period's move-in — or when stalls
 * open, for a show without periods — unless they booked that period's Early
 * Move-In Pass, which opens it at the pass's own day. The first of those is the
 * earliest they can move in; the last period's move-out is when they must be
 * gone. Before anything is booked the form says when stalls open, as it always
 * has. Every one of these is a flag, never a refusal: an early arrival or a late
 * departure is the office's to allow.
 */
import type { StallPeriod } from './stall-periods';
import {
  earlyMoveInPass,
  formatStallsOpen,
  isEarlyMoveInPass,
  passMoveIn,
  periodPass,
} from './stalls-open';

export type MoveInLine = {
  id: string;
  code: string;
  label: string;
  unit: string;
  stall_kind?: string | null;
  stall_period_id?: string | null;
  move_in_date?: string | null;
  move_in_time?: string | null;
  move_in_end_date?: string | null;
  move_in_end_time?: string | null;
};

export type MoveInNote = { text: string; warn: boolean };

type Context = {
  lines: readonly MoveInLine[];
  quantities: Record<string, number>;
  periods: readonly StallPeriod[];
  stallsOpenDate?: string | null;
  stallsOpenTime?: string | null;
};

/** A stall a horse or tack moves into, as booked — not a pass or other add-on. */
function bookedStalls({ lines, quantities }: Context): MoveInLine[] {
  return lines.filter(
    (line) =>
      line.unit === 'per_stall' &&
      line.stall_kind !== 'add_on' &&
      !isEarlyMoveInPass(line) &&
      (quantities[line.id] ?? 0) > 0,
  );
}

function sortKey(date: string, time: string | null | undefined): string {
  return `${date}T${(time ?? '').slice(0, 5) || '00:00'}`;
}

/** "Move in from Tuesday, September 21 at 4:00 PM, before Pleasure stalls open
 *  (Wednesday, September 22 at 4:00 PM)." — the line under a pass. */
export function passLineText(
  pass: MoveInLine,
  periods: readonly StallPeriod[],
  stallsOpenDate?: string | null,
  stallsOpenTime?: string | null,
): string {
  const period = pass.stall_period_id
    ? periods.find((p) => p.id === pass.stall_period_id)
    : undefined;
  const opens = period
    ? formatStallsOpen(period.move_in_date, period.move_in_time)
    : formatStallsOpen(stallsOpenDate, stallsOpenTime);
  const before = `before ${period ? `${period.name} stalls open` : 'stalls open'}${
    opens ? ` (${opens})` : ''
  }`;
  const from = passMoveIn(pass);
  return from ? `Move in from ${from}, ${before}.` : `Move in ${before}.`;
}

/** What to say under the arrival day, or null when there is nothing to say. */
export function arrivalNote(arrival: string, ctx: Context): MoveInNote | null {
  const { lines, quantities, periods, stallsOpenDate, stallsOpenTime } = ctx;
  const stallsOpen = formatStallsOpen(stallsOpenDate, stallsOpenTime);
  const stalls = bookedStalls(ctx);

  if (stalls.length === 0) {
    // Nothing booked yet: the barn's own day, as before stall periods.
    if (!stallsOpen || !stallsOpenDate) return null;
    if (!arrival || arrival >= stallsOpenDate) return { text: `Stalls open ${stallsOpen}.`, warn: false };
    const pass = earlyMoveInPass(lines);
    const from = passMoveIn(pass);
    return {
      text: pass
        ? `That's before stalls open (${stallsOpen}). Add an Early Move-In Pass above${
            from ? ` (move in from ${from})` : ''
          }, or check with the show office.`
        : `That's before stalls open (${stallsOpen}). Check with the show office first.`,
      warn: true,
    };
  }

  type Opening = {
    date: string | null;
    time: string | null;
    viaPass: boolean;
    /** The booked stall's period, or undefined for a whole-show stall. */
    periodName?: string;
    pass?: MoveInLine;
  };
  const openings: Opening[] = stalls.map((line) => {
    const period = line.stall_period_id
      ? periods.find((p) => p.id === line.stall_period_id)
      : undefined;
    const pass = period ? periodPass(lines, period.id) : earlyMoveInPass(lines);
    const periodName = period?.name;
    if (pass && (quantities[pass.id] ?? 0) > 0) {
      return { date: pass.move_in_date ?? null, time: pass.move_in_time ?? null, viaPass: true, periodName, pass };
    }
    return {
      date: (period ? period.move_in_date : stallsOpenDate) ?? null,
      time: (period ? period.move_in_time : stallsOpenTime) ?? null,
      viaPass: false,
      periodName,
      pass,
    };
  });

  // A pass with no day of its own moves its holder in "before stalls open":
  // there is no earliest day to hold an arrival against.
  if (openings.some((o) => o.viaPass && !o.date)) {
    return { text: "You've added an Early Move-In Pass.", warn: false };
  }
  const dated = openings.filter((o) => o.date) as (Opening & { date: string })[];
  if (dated.length === 0) return null;
  const first = dated.reduce((a, b) => (sortKey(b.date, b.time) < sortKey(a.date, a.time) ? b : a));
  const when = formatStallsOpen(first.date, first.time) ?? first.date;

  if (!arrival || arrival >= first.date) {
    if (first.viaPass) return { text: `Your Early Move-In Pass moves you in from ${when}.`, warn: false };
    return {
      text: first.periodName ? `Your ${first.periodName} stall opens ${when}.` : `Stalls open ${when}.`,
      warn: false,
    };
  }
  const opens = first.periodName ? `your ${first.periodName} stall opens` : 'stalls open';
  if (first.viaPass) {
    return {
      text: `That's before your Early Move-In Pass moves you in (${when}). Check with the show office first.`,
      warn: true,
    };
  }
  const from = passMoveIn(first.pass);
  return {
    text: first.pass
      ? `That's before ${opens} (${when}). Add the Early Move-In Pass above${
          from ? ` (move in from ${from})` : ''
        }, or check with the show office.`
      : `That's before ${opens} (${when}). Check with the show office first.`,
    warn: true,
  };
}

/** What to say under the departure day: when the last booked period's stalls
 *  must be out. Null for a show without periods, which states no move-out. */
export function departureNote(departure: string, ctx: Context): MoveInNote | null {
  const closings = bookedStalls(ctx)
    .map((line) => ctx.periods.find((p) => p.id === line.stall_period_id))
    .filter((p): p is StallPeriod => Boolean(p));
  if (closings.length === 0) return null;
  const last = closings.reduce((a, b) =>
    sortKey(b.move_out_date, b.move_out_time) > sortKey(a.move_out_date, a.move_out_time) ? b : a,
  );
  const day = formatStallsOpen(last.move_out_date, last.move_out_time) ?? last.move_out_date;
  const note = last.move_out_note?.trim();
  const when = note ? `${day}, ${note}` : day;
  if (departure && departure > last.move_out_date) {
    return {
      text: `That's after your ${last.name} stall must be out (${when}). Check with the show office first.`,
      warn: true,
    };
  }
  return { text: `Your ${last.name} stall must be out ${when}.`, warn: false };
}
