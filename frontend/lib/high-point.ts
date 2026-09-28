/**
 * High-point standings (migration 147) — the types, and the few rules every
 * screen that prints a points chart has to agree on.
 *
 * Client-safe: the admin editors are client components. The server fetchers
 * are `fetchShowLeaderboard` / `fetchCircuitLeaderboard` / `fetchPointSystems`
 * in `lib/api.ts`.
 */

export type PointAward = { min_entries: number; place: number; points: number };

export type PointSystem = {
  id: string;
  name: string;
  /** The show company that owns it (migration 148). Only its members see or
   *  choose it; null is a system only GaitDesk admins can use. */
  company_id: string | null;
  company_name: string | null;
  /** No company: a GaitDesk standard system — the associations' own charts
   *  (migration 151) — every company may choose and only an admin may change. */
  standard: boolean;
  association_id: string | null;
  association_code: string | null;
  notes: string | null;
  awards: PointAward[];
  show_count: number;
  circuit_count: number;
};

/** A company a points system may be kept under, from `GET /point-systems/companies`. */
export type PointSystemOwner = { id: string; name: string; personal: boolean };

export type Standing = {
  rank: number;
  exhibitor_id: string;
  exhibitor_name: string;
  horse_id: string | null;
  horse_name: string | null;
  points: number;
  class_count: number;
  show_count: number;
};

export type DivisionStandings = { name: string; standings: Standing[] };

export type CircuitSummary = { id: string; name: string; season: string | null };

export type ShowLeaderboard = {
  show_id: string;
  point_system: PointSystem | null;
  posted_class_count: number;
  divisions: DivisionStandings[];
  circuits: CircuitSummary[];
};

export type CircuitShow = {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
};

export type Circuit = CircuitSummary & {
  notes: string | null;
  created_by_user_id: string | null;
  point_system: { id: string; name: string } | null;
  shows: CircuitShow[];
};

export type CircuitLeaderboard = Omit<Circuit, 'point_system'> & {
  point_system: PointSystem | null;
  posted_class_count: number;
  divisions: DivisionStandings[];
};

/** "6" or "2.5" — charts award half points, and "6.00" reads as a price. */
export function formatPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : String(Math.round(points * 100) / 100);
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** The chart as bands: each band is a class size and the points by place. */
export function chartBands(awards: PointAward[]): { minEntries: number; points: number[] }[] {
  const byBand = new Map<number, Map<number, number>>();
  for (const a of awards) {
    if (!byBand.has(a.min_entries)) byBand.set(a.min_entries, new Map());
    byBand.get(a.min_entries)!.set(a.place, a.points);
  }
  return [...byBand.keys()]
    .sort((a, b) => a - b)
    .map((minEntries) => {
      const places = byBand.get(minEntries)!;
      const last = Math.max(...places.keys());
      return {
        minEntries,
        points: Array.from({ length: last }, (_, i) => places.get(i + 1) ?? 0),
      };
    });
}

/** "Classes of 3–5", "Classes of 6 or more", "Any class". */
export function bandLabel(bands: { minEntries: number }[], index: number): string {
  const min = bands[index].minEntries;
  const next = bands[index + 1]?.minEntries;
  if (next === undefined) return min <= 1 ? 'Any class' : `Classes of ${min} or more`;
  const max = next - 1;
  if (max === min) return `Classes of ${min}`;
  return `Classes of ${min}–${max}`;
}
