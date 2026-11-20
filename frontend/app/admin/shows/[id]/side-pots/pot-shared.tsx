/**
 * Shared vocabulary for the side pot screens.
 *
 * The pot page is a hub with three working screens under it — Settings, Side Pot
 * Entries, and Standings — so the types, the status badge, the breadcrumb trail,
 * and the pool math are defined once here rather than restated on each.
 */

import Link from 'next/link';

export type ScoreType = 'placement' | 'pattern' | 'time';
export type ScoringMethod = 'sum_placings' | 'sum_scores' | 'fastest_time';
export type EligibilityRule = 'all_classes' | 'any_class';
export type Status = 'open' | 'closed' | 'settled';

export interface ClassItem {
  id: string;
  class_number: string;
  class_name: string;
  class_date: string;
  score_type: ScoreType;
}

export interface PotClass {
  class_id: string;
  class_number: string;
  class_name: string;
  score_type: ScoreType;
}

export interface SidePot {
  id: string;
  show_id: string;
  name: string;
  description: string | null;
  entry_fee_cents: number;
  payback_percent: number;
  scoring_method: ScoringMethod;
  eligibility_rule: EligibilityRule;
  payout_schedule: Record<string, number[]>;
  status: Status;
  settled_at: string | null;
  classes: PotClass[];
  entry_count: number;
  paid_count: number;
  /** Money the show adds to the pool on top of the buy-ins' payback
   *  (migration 205). `?? 0` at every use, for a backend from before it. */
  added_money_cents?: number;
  /** A `fastest_time` pot's Ds: how many, how far apart (ms behind the fastest
   *  time), and each D's share of the pool, fastest first. */
  d_count?: number;
  d_split_ms?: number;
  d_percents?: number[];
  /** Paid on time and bought into one run at a time. */
  per_run?: boolean;
}

/** One back number's place in the pot. "Entry" here is the pot entry, not the
 *  class entry — the pot is joined at the show_entry (back number) level. */
export interface PotEntry {
  id: string;
  side_pot_id: string;
  show_entry_id: string;
  back_number: number | null;
  /** Every number the exhibitor wears — one per horse at a show that numbers
   *  horses (migration 161). */
  back_numbers?: number[];
  exhibitor_name: string | null;
  paid: boolean;
  created_at: string;
  /** The run, in a pot paid on time (migration 205). */
  entry_id?: string | null;
  run_label?: string | null;
}

/** A run a pot paid on time can be bought into: an entry in one of its
 *  classes (migration 205). */
export interface PotRun {
  entry_id: string;
  show_entry_id: string | null;
  back_number: number | null;
  exhibitor_name: string | null;
  horse_name: string | null;
  class_id: string;
  class_number: string;
  class_name: string;
  run_label: string;
  joined: boolean;
}

/** A show roster row offered by the Add-to-pot picker. */
export interface RosterEntry {
  show_entry_id: string;
  back_number: number | null;
  /** Every number the exhibitor wears — one per horse at a show that numbers
   *  horses (migration 161). */
  back_numbers?: number[];
  exhibitor_name: string | null;
}

export interface Standing {
  show_entry_id: string;
  back_number: number | null;
  /** Every number the exhibitor wears — one per horse at a show that numbers
   *  horses (migration 161). */
  back_numbers?: number[];
  exhibitor_name: string | null;
  aggregate_value: number;
  place: number | null;
  is_eligible: boolean;
  missing_class_ids: string[];
  paid: boolean;
  /** A time pot's standing is a run (migration 205): `place` is the place
   *  inside its D and `aggregate_value` the time. */
  side_pot_entry_id?: string | null;
  entry_id?: string | null;
  run_label?: string | null;
  d_number?: number | null;
  behind_ms?: number | null;
}

export interface DLine {
  d_number: number;
  percent: number;
  from_time: number | null;
  runners: number;
  paid_places: number;
  amount_cents: number;
}

export interface Standings {
  side_pot_id: string;
  status: Status;
  scoring_method: ScoringMethod;
  eligibility_rule: EligibilityRule;
  total_pool_cents: number;
  payout_pool_cents: number;
  standings: Standing[];
  projected_payouts: Record<string, number>;
  added_money_cents?: number;
  d_lines?: DLine[];
  /** Pool money no place can take; the office decides what happens to it. */
  unawarded_cents?: number;
}

export interface Payout {
  id: string;
  side_pot_id: string;
  show_entry_id: string;
  back_number: number | null;
  /** Every number the exhibitor wears — one per horse at a show that numbers
   *  horses (migration 161). */
  back_numbers?: number[];
  exhibitor_name: string | null;
  place: number;
  payout_cents: number;
  aggregate_value: number;
  tiebreaker_notes: string | null;
  entry_id?: string | null;
  d_number?: number | null;
  run_label?: string | null;
}

export const STATUS_BADGE: Record<Status, { label: string; bg: string; fg: string }> = {
  open: { label: 'Open', bg: 'var(--success-border)', fg: 'var(--success)' },
  closed: { label: 'Closed', bg: 'var(--bg-subtle)', fg: 'var(--accent)' },
  settled: { label: 'Settled', bg: 'var(--border)', fg: 'var(--text-deep)' },
};

export const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function StatusPill({ status }: { status: Status }) {
  const badge = STATUS_BADGE[status];
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full"
      style={{ backgroundColor: badge.bg, color: badge.fg }}
    >
      {badge.label}
    </span>
  );
}

/**
 * The pot's pool as the paid count changes.
 *
 * Mirrors `billing.side_pot_money()` — same floor on the payback split, so the
 * figure the desk watches while ticking boxes matches the one Financials
 * reports. `GET /standings` returns the same numbers server-side; this exists
 * for the Entries screen, where the pool has to move as boxes are ticked
 * without a round trip.
 */
export function potMoney(
  pot: Pick<SidePot, 'entry_fee_cents' | 'payback_percent' | 'added_money_cents'>,
  paidCount: number,
) {
  const buyInsCents = pot.entry_fee_cents * paidCount;
  const paybackCents = Math.floor((buyInsCents * pot.payback_percent) / 100);
  // Added money goes into the pool on top of the payback, and is not part of
  // what the show keeps of the buy-ins (migration 205).
  const addedCents = pot.added_money_cents ?? 0;
  return {
    buyInsCents,
    addedCents,
    payoutPoolCents: paybackCents + addedCents,
    retainedCents: buyInsCents - paybackCents,
  };
}

export const SCORING_LABEL: Record<ScoringMethod, string> = {
  sum_placings: 'Sum of placings (lowest wins)',
  sum_scores: 'Sum of scores (highest wins)',
  fastest_time: 'Fastest time, paid in Ds (lowest wins)',
};

/** Each D's share of the pool when the office has not said — the backend's
 *  `DEFAULT_D_PERCENTS`, so a form shows what saving would store. */
export function defaultDPercents(dCount: number): number[] {
  const known: Record<number, number[]> = {
    1: [100],
    2: [60, 40],
    3: [50, 30, 20],
    4: [40, 30, 20, 10],
    5: [30, 25, 20, 15, 10],
  };
  if (known[dCount]) return [...known[dCount]];
  const even = Array.from({ length: dCount }, () => Math.floor(100 / dCount));
  even[0] += 100 - even.reduce((a, b) => a + b, 0);
  return even;
}

/** "5D, half-second splits" — how a time pot's Ds read on a screen. */
export function dSummary(pot: Pick<SidePot, 'd_count' | 'd_split_ms'>): string {
  const count = pot.d_count ?? 1;
  if (count <= 1) return 'One field: fastest time wins';
  const seconds = (pot.d_split_ms ?? 500) / 1000;
  return `${count}D, ${seconds === 0.5 ? 'half-second' : `${seconds}-second`} splits`;
}

export const ELIGIBILITY_LABEL: Record<EligibilityRule, string> = {
  all_classes: 'Must place in every bundled class',
  any_class: 'Missing classes count as last + 1',
};

/**
 * Admin › Shows › {show} › Side Pots › {pot} › {leaf}. The pot links back to its
 * own hub on every sub-screen, so `Breadcrumbs` renders "← Back to {pot}" rather
 * than dropping the user out to the pot list.
 */
export function potCrumbs(
  showId: string,
  showName: string,
  pot: Pick<SidePot, 'id' | 'name'>,
  leaf?: string,
) {
  return [
    { label: 'Admin', href: '/admin' },
    { label: 'Shows', href: '/admin/shows' },
    { label: showName, href: `/admin/shows/${showId}` },
    { label: 'Side Pots', href: `/admin/shows/${showId}/side-pots` },
    leaf
      ? { label: pot.name, href: `/admin/shows/${showId}/side-pots/${pot.id}` }
      : { label: pot.name },
    ...(leaf ? [{ label: leaf }] : []),
  ];
}

/**
 * The same way back the breadcrumb offers, repeated at the foot of each
 * sub-screen. Standings and entries both run past a screenful, so the trail at
 * the top has scrolled away by the time someone is done and wants back out to
 * the pot.
 */
export function BackToPot({
  showId,
  pot,
}: {
  showId: string;
  pot: Pick<SidePot, 'id' | 'name'>;
}) {
  return (
    <div className="pt-2">
      <Link
        href={`/admin/shows/${showId}/side-pots/${pot.id}`}
        className="text-sm hover:underline"
        style={{ color: 'var(--accent)' }}
      >
        ← Back to {pot.name}
      </Link>
    </div>
  );
}
