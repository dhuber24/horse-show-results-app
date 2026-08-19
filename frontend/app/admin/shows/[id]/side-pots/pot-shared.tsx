/**
 * Shared vocabulary for the side pot screens.
 *
 * The pot page is a hub with three working screens under it — Settings, Side Pot
 * Entries, and Standings — so the types, the status badge, the breadcrumb trail,
 * and the pool math are defined once here rather than restated on each.
 */

import Link from 'next/link';

export type ScoreType = 'placement' | 'pattern' | 'time';
export type ScoringMethod = 'sum_placings' | 'sum_scores';
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
}

/** One back number's place in the pot. "Entry" here is the pot entry, not the
 *  class entry — the pot is joined at the show_entry (back number) level. */
export interface PotEntry {
  id: string;
  side_pot_id: string;
  show_entry_id: string;
  back_number: number | null;
  exhibitor_name: string | null;
  paid: boolean;
  created_at: string;
}

/** A show roster row offered by the Add-to-pot picker. */
export interface RosterEntry {
  show_entry_id: string;
  back_number: number | null;
  exhibitor_name: string | null;
}

export interface Standing {
  show_entry_id: string;
  back_number: number | null;
  exhibitor_name: string | null;
  aggregate_value: number;
  place: number | null;
  is_eligible: boolean;
  missing_class_ids: string[];
  paid: boolean;
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
}

export interface Payout {
  id: string;
  side_pot_id: string;
  show_entry_id: string;
  back_number: number | null;
  exhibitor_name: string | null;
  place: number;
  payout_cents: number;
  aggregate_value: number;
  tiebreaker_notes: string | null;
}

export const STATUS_BADGE: Record<Status, { label: string; bg: string; fg: string }> = {
  open: { label: 'Open', bg: '#dcebd5', fg: '#3f6b2f' },
  closed: { label: 'Closed', bg: '#f0e8d8', fg: '#8b4513' },
  settled: { label: 'Settled', bg: '#d4d4d4', fg: '#404040' },
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
  pot: Pick<SidePot, 'entry_fee_cents' | 'payback_percent'>,
  paidCount: number,
) {
  const buyInsCents = pot.entry_fee_cents * paidCount;
  const payoutPoolCents = Math.floor((buyInsCents * pot.payback_percent) / 100);
  return {
    buyInsCents,
    payoutPoolCents,
    retainedCents: buyInsCents - payoutPoolCents,
  };
}

export const SCORING_LABEL: Record<ScoringMethod, string> = {
  sum_placings: 'Sum of placings (lowest wins)',
  sum_scores: 'Sum of scores (highest wins)',
};

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
        style={{ color: '#8b4513' }}
      >
        ← Back to {pot.name}
      </Link>
    </div>
  );
}
