/**
 * Shared vocabulary for the futurity screens.
 *
 * The futurity page is a hub with four working screens under it — Settings,
 * Hi-Point, Entries and Standings — so the types, the breadcrumb trail, and the
 * money formatting are defined once here rather than restated on each. Mirrors
 * `pot-shared.tsx`, which does the same job for side pots.
 */

import Link from 'next/link';

export type DivisionScoring = 'sum_placings' | 'sum_scores';
export type ClassScoring = 'counts' | 'best_of_group';

export interface ClassItem {
  id: string;
  class_number: string;
  class_name: string;
  class_date: string;
  entry_fee_cents: number;
}

export interface FuturityClass {
  class_id: string;
  class_number: string;
  class_name: string;
  class_date: string;
  entry_fee_cents: number;
}

export interface FeeTier {
  id: string;
  name: string;
  description: string | null;
  amount_cents: number;
  sort_order: number;
}

export interface DivisionClass {
  class_id: string;
  class_number: string | null;
  class_name: string | null;
  scoring: ClassScoring;
  group_name: string | null;
}

export interface Division {
  id: string;
  futurity_id: string;
  name: string;
  scoring_method: DivisionScoring;
  sort_order: number;
  classes: DivisionClass[];
}

export interface Futurity {
  id: string;
  show_id: string;
  name: string;
  description: string | null;
  entry_deadline: string | null;
  late_fee_cents: number;
  office_fee_member_cents: number;
  office_fee_nonmember_cents: number;
  created_at: string;
  classes: FuturityClass[];
  fee_tiers: FeeTier[];
  divisions: Division[];
  entry_count: number;
}

/** One horse enrolled in the futurity. "Entry" here is the enrollment, not a
 *  class entry — the horse's class entries are ordinary `entries` rows, and
 *  `entered_class_count` is how many of the futurity's classes it is in. */
export interface FuturityEntry {
  id: string;
  futurity_id: string;
  show_entry_id: string;
  horse_id: string | null;
  horse_name: string | null;
  back_number: number | null;
  exhibitor_name: string | null;
  fee_tier_id: string | null;
  fee_tier_name: string | null;
  is_member: boolean;
  entered_at: string;
  is_late: boolean;
  entered_class_count: number;
  charge_cents: number;
  notes: string | null;
  created_at: string;
}

export interface Standing {
  futurity_entry_id: string;
  horse_id: string | null;
  horse_name: string | null;
  back_number: number | null;
  exhibitor_name: string | null;
  place: number | null;
  aggregate_value: number | null;
  counted: DivisionClass[];
  missing_class_numbers: string[];
  is_eligible: boolean;
}

export interface Standings {
  futurity_id: string;
  division_id: string;
  division_name: string;
  scoring_method: DivisionScoring;
  standings: Standing[];
}

export const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  border: '#d4b896',
  bg: '#fff',
  accent: '#8b4513',
} as const;

export const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export const SCORING_LABEL: Record<DivisionScoring, string> = {
  sum_placings: 'Sum of placings (lowest wins)',
  sum_scores: 'Sum of scores (highest wins)',
};

/** Parsed as local parts rather than `new Date(iso)`, which reads a bare
 *  yyyy-mm-dd as UTC midnight and can render the previous day west of it. */
export function formatDate(value: string | null): string {
  if (!value) return '—';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Admin › Shows › {show} › Futurities › {futurity} › {leaf}. The futurity links
 * back to its own hub on every sub-screen, so `Breadcrumbs` renders
 * "← Back to {futurity}" rather than dropping the user out to the list.
 */
export function futurityCrumbs(
  showId: string,
  showName: string,
  futurity: Pick<Futurity, 'id' | 'name'>,
  leaf?: string,
) {
  return [
    { label: 'Admin', href: '/admin' },
    { label: 'Shows', href: '/admin/shows' },
    { label: showName, href: `/admin/shows/${showId}` },
    { label: 'Futurities', href: `/admin/shows/${showId}/futurities` },
    leaf
      ? { label: futurity.name, href: `/admin/shows/${showId}/futurities/${futurity.id}` }
      : { label: futurity.name },
    ...(leaf ? [{ label: leaf }] : []),
  ];
}

/**
 * The same way back the breadcrumb offers, repeated at the foot of each
 * sub-screen. The entries and Hi-Point screens both run past a screenful, so
 * the trail at the top has scrolled away by the time someone wants back out.
 */
export function BackToFuturity({
  showId,
  futurity,
}: {
  showId: string;
  futurity: Pick<Futurity, 'id' | 'name'>;
}) {
  return (
    <div className="pt-2">
      <Link
        href={`/admin/shows/${showId}/futurities/${futurity.id}`}
        className="text-sm hover:underline"
        style={{ color: COLORS.accent }}
      >
        ← Back to {futurity.name}
      </Link>
    </div>
  );
}

/**
 * A futurity class priced on the class row is a double charge waiting to
 * happen: the tier already supplies the per-class rate, so `entry_fee_cents`
 * must be zero on every class in the program (migration 107). Surfaced rather
 * than silently corrected, because the fix belongs on the class, and a screen
 * that quietly zeroed it would hide a real mistake in the schedule.
 */
export function PricedClassWarning({
  showId,
  classes,
}: {
  showId: string;
  classes: Pick<FuturityClass, 'class_id' | 'class_number' | 'entry_fee_cents'>[];
}) {
  const priced = classes.filter((c) => c.entry_fee_cents > 0);
  if (priced.length === 0) return null;
  return (
    <div
      className="rounded border px-3 py-2 text-sm"
      style={{ borderColor: '#c0392b', backgroundColor: '#fef0ef', color: '#922' }}
    >
      <strong>
        {priced.length === 1 ? 'One class carries' : `${priced.length} classes carry`} their
        own entry fee.
      </strong>{' '}
      A futurity charges its classes at the entrant&rsquo;s tier rate, so a fee on
      the class itself is billed on top of it. Set{' '}
      {priced.map((c, i) => (
        <span key={c.class_id}>
          {i > 0 && ', '}
          <Link
            href={`/admin/shows/${showId}/classes`}
            className="underline"
            style={{ color: '#922' }}
          >
            #{c.class_number}
          </Link>
        </span>
      ))}{' '}
      to $0.00 on the Classes screen.
    </div>
  );
}
