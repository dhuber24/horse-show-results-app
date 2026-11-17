/**
 * Stall periods, what a stall line sells, and the stall checks (migration 194).
 *
 * A show may sell the same stall for different windows: WSCA's Championship
 * Show sells a full-show stall (Wednesday 4 PM to Monday), a pleasure stall
 * (out an hour after your last class Friday) and a games stall (in no earlier
 * than 9 PM Friday). Each window is a `StallPeriod`, wall-clock at the venue and
 * printed as the office typed it, like `stalls_open_*` (see `stalls-open.ts`).
 *
 * The checks themselves are worked out by `backend/stabling.py`; this file only
 * words them. They are flags, never refusals.
 */
import { formatStallsOpen } from './stalls-open';

/** What a line priced per stall sells (migrations 194 and 198): a box, tie or
 *  tack stall, or an add-on priced per stall that is not a stall, such as the
 *  Early Move-In Pass. Mirrors `stabling.STALL_KINDS`. */
export type StallKind = 'box' | 'tie' | 'tack' | 'add_on';

/** The three stall types a stall period prices, in the order they are listed
 *  on the Lodging step and at sign-up. Each is priced on its own, period by
 *  period, and exhibitors book how many of each they want. */
export const STALL_TYPES = ['box', 'tie', 'tack'] as const;
export type StallType = (typeof STALL_TYPES)[number];

export const STALL_TYPE_LABEL: Record<StallType, string> = {
  box: 'Box stall',
  tie: 'Tie stall',
  tack: 'Tack stall',
};

export function isStallType(kind: string | null | undefined): kind is StallType {
  return (STALL_TYPES as readonly string[]).includes(kind ?? '');
}

/** A box or a tie stall: one a horse stands in. Mirrors `stabling.HORSE_KINDS`;
 *  `horse` is the kind before migration 198, on a payload from before it. */
export function isHorseStallKind(kind: string | null | undefined): boolean {
  return kind === 'box' || kind === 'tie' || kind === 'horse';
}

/** What the office picks a line's kind from, for a line that is not one of a
 *  period's three stall prices (the Lodging step's *Other charges per stall*). */
export const STALL_KIND_OPTIONS: { value: StallKind; label: string; hint: string }[] = [
  { value: 'box', label: 'Box stall', hint: 'A box stall a horse stands in.' },
  { value: 'tie', label: 'Tie stall', hint: 'A tie stall a horse stands in.' },
  { value: 'tack', label: 'Tack stall', hint: 'Holds tack, not a horse. Needs no shavings.' },
  {
    value: 'add_on',
    label: 'Add-on, not a stall',
    hint: 'Charged per stall but is not one, such as a cleaning deposit.',
  },
];

export type StallPeriod = {
  id: string;
  name: string;
  /** yyyy-mm-dd, the venue's own day. */
  move_in_date: string;
  /** HH:MM(:SS) or null for a day with no hour. */
  move_in_time: string | null;
  move_out_date: string;
  move_out_time: string | null;
  /** A move-out no clock states: "1 hour after your last class". */
  move_out_note: string | null;
  /** What exhibitors should know about moving in for this period (migration
   *  199): where to unload, where stall assignments are posted. Line breaks
   *  kept. */
  move_in_notes?: string | null;
};

/** "In Wednesday, September 23 at 4:00 PM · out Friday, September 25, 1 hour
 *  after your last class". Either half is left out when it cannot be read. */
export function periodWindow(period: StallPeriod): string {
  const moveIn = formatStallsOpen(period.move_in_date, period.move_in_time);
  const moveOutDay = formatStallsOpen(period.move_out_date, period.move_out_time);
  const note = period.move_out_note?.trim();
  const moveOut = moveOutDay && note ? `${moveOutDay}, ${note}` : moveOutDay ?? note ?? null;
  return [moveIn && `In ${moveIn}`, moveOut && `out ${moveOut}`].filter(Boolean).join(' · ');
}

export type StallCheck =
  | {
      code: 'HORSE_STALLS_SHORT';
      /** yyyy-mm-dd, the days these horses show on fewer horse stalls. */
      dates: string[];
      horses: string[];
      stalls: number;
    }
  | {
      code: 'TACK_STALL_HORSES';
      show_fee_id: string;
      label: string;
      period: string | null;
      tack_stalls: number;
      horses_per_tack_stall: number;
      horse_stalls: number;
    }
  | {
      /** An Early Move-In Pass booked without the stalls it moves in early
       *  (migration 196): more passes than stalls in its period, or one sold
       *  per exhibitor with no stall in its period at all. */
      code: 'PASS_WITHOUT_STALL';
      show_fee_id: string;
      label: string;
      period: string | null;
      passes: number;
      stalls: number;
      one_per_exhibitor: boolean;
    };

const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sat, Sep 26", read as date parts so no zone can move the day. */
export function shortDay(value: string): string {
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return value;
  return `${SHORT_WEEKDAYS[new Date(y, m - 1, d).getDay()]}, ${SHORT_MONTHS[m - 1]} ${d}`;
}

/** "Buddy", "Buddy and Rio", "Buddy, Rio and Pepper". */
export function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

/**
 * One check as a sentence. `you` is the exhibitor reading about their own
 * stalls; `they` is the office reading about somebody's at the desk.
 */
export function stallCheckText(check: StallCheck, voice: 'you' | 'they'): string {
  if (check.code === 'HORSE_STALLS_SHORT') {
    const horses = listOf(check.horses);
    const days = listOf(check.dates.map(shortDay));
    const many = check.horses.length > 1;
    if (voice === 'they') {
      return check.stalls === 0
        ? `${horses} show${many ? '' : 's'} ${days} with no horse stall.`
        : `${horses} show${many ? '' : 's'} ${days} on ${plural(check.stalls, 'horse stall')}.`;
    }
    const thoseDays = check.dates.length === 1 ? 'that day' : 'those days';
    const covering =
      check.stalls === 0
        ? `none of your horse stalls covers ${thoseDays}`
        : `only ${check.stalls} of your horse stalls ${check.stalls === 1 ? 'covers' : 'cover'} ${thoseDays}`;
    return `${horses} show${many ? '' : 's'} ${days}, and ${covering}.`;
  }
  const where = check.period ? ` in the ${check.period} period` : '';
  if (check.code === 'PASS_WITHOUT_STALL') {
    if (check.one_per_exhibitor || check.stalls === 0) {
      return voice === 'they'
        ? `${check.label}: booked with no stall${where}.`
        : `${check.label}: you have no stall${where} for it to move in early.`;
    }
    return voice === 'they'
      ? `${check.label}: ${plural(check.passes, 'pass', 'passes')} for ${plural(check.stalls, 'stall')}${where}.`
      : `${check.label}: ${plural(check.passes, 'pass', 'passes')} for ${plural(check.stalls, 'stall')}${where} — one pass moves one stall in early.`;
  }
  const need = check.tack_stalls * check.horses_per_tack_stall;
  if (voice === 'they') {
    return (
      `${check.label}: ${plural(check.tack_stalls, 'tack stall')} on ` +
      `${plural(check.horse_stalls, 'horse stall')}${where}; needs ${need}.`
    );
  }
  return (
    `${check.label}: each tack stall needs ${plural(check.horses_per_tack_stall, 'horse stall')}` +
    `${where}. You have ${check.horse_stalls} for ${plural(check.tack_stalls, 'tack stall')}.`
  );
}
