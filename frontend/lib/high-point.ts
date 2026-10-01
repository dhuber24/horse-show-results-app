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
  /** Set: this is that show's own chart (migration 153) — copied from a
   *  template on its High Point page, and never offered anywhere else. */
  show_id: string | null;
  /** No company and no show: a GaitDesk standard system — the associations'
   *  own charts (migration 151) — every company may choose and only an admin
   *  may change. */
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
  /** The exhibitor's number at this show — on a show's leaderboard only. A
   *  circuit spans several shows, where one exhibitor has several numbers. */
  back_number?: number | null;
};

/** One standings table: a division, its points added up across every
 *  discipline — Amateur Halter and Amateur Western Pleasure both count toward
 *  "Amateur". */
export type DivisionStandings = {
  name: string;
  standings: Standing[];
};

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

/** A line of a shortened standings list: a pair, or a tie too long to list. */
export type StandingLine =
  | { kind: 'pair'; standing: Standing }
  | { kind: 'tied'; rank: number; count: number; points: number };

/**
 * The top `places` ranks of a division, in at most `maxRows` lines — what a
 * results board has room for.
 *
 * By rank, not by row, and a tie is never split: showing one of two pairs on
 * the same points is choosing between them. What a board cannot do is list
 * every pair in a long tie — early in a show whole runs of pairs sit on the
 * same points — so a tie that would run past `maxRows` becomes one line,
 * "4 tied for 5th", with their points. It is always the last line: the rank
 * after it is past `places` by then. `standings` arrive ranked 1, 2, 2, 4
 * (`backend/high_point.py`).
 */
export function topStandings(standings: Standing[], places: number, maxRows: number): StandingLine[] {
  const top = standings.filter((s) => s.rank <= places);
  const lines: StandingLine[] = [];
  for (let i = 0; i < top.length; ) {
    const rank = top[i].rank;
    let j = i;
    while (j < top.length && top[j].rank === rank) j++;
    const tied = top.slice(i, j);
    if (lines.length + tied.length > maxRows) {
      lines.push({ kind: 'tied', rank, count: tied.length, points: tied[0].points });
      break;
    }
    for (const standing of tied) lines.push({ kind: 'pair', standing });
    i = j;
  }
  return lines;
}

// ── Editing a chart ────────────────────────────────────────────────────────────
//
// One grid editor serves the Points Systems library and a show's own chart
// (migration 153), so the rules for what a grid means live here rather than in
// either screen. Cells are strings while they are being typed: "0." and "" are
// real states of an input, and a number would lose them.

/** A row of the grid: the smallest class size it covers, and points by place. */
export type ChartRow = { minEntries: string; points: string[] };

/** The grid being edited: every row is `places` cells wide. */
export type ChartDraft = { places: number; bands: ChartRow[] };

/** Wider than any printed chart; keeps the grid on a screen. */
export const MAX_PLACES = 30;

/** A new chart starts with the one row every chart has: a class of one horse,
 *  which can only place first. "+ Class-size row" builds it out from there. */
export function blankChart(): ChartDraft {
  return { places: 1, bands: [{ minEntries: '1', points: [''] }] };
}

function wholeNumber(value: string): number | null {
  const n = Number(value);
  return value.trim() !== '' && Number.isInteger(n) && n >= 1 ? n : null;
}

/** The last class size a row covers: one below where the next row starts. A
 *  row stores only its first size, so this is how "3–4" is kept -- the 4 is the
 *  next row's 5, less one. Null for the last row, which covers every bigger
 *  class, and while the next row's start is not a number yet. */
export function rowTop(bands: ChartRow[], index: number): number | null {
  const next = bands[index + 1];
  if (!next) return null;
  const nextFrom = wholeNumber(next.minEntries);
  return nextFrom === null ? null : nextFrom - 1;
}

/** How many places a row may award: as many as the largest class in its
 *  range, so a 5–9 row pays down to 9th (migration 152). The last row is
 *  open-ended and has only its first size to go by, so "45 & over" pays at most
 *  45. 0 while the range is not whole numbers in order -- nothing can be typed
 *  until it is. */
export function placeLimit(bands: ChartRow[], index: number): number {
  const from = wholeNumber(bands[index].minEntries);
  if (from === null) return 0;
  if (index === bands.length - 1) return from;
  const top = rowTop(bands, index);
  return top !== null && top >= from ? top : 0;
}

/** "3–4", "2", or "45 or more". */
export function rangeText(bands: ChartRow[], index: number): string {
  const from = bands[index].minEntries || '?';
  if (index === bands.length - 1) return `${from} or more`;
  const top = rowTop(bands, index);
  return top === null ? `${from}–?` : String(top) === from ? from : `${from}–${top}`;
}

/** The most places any row may award -- no column past it could ever be filled. */
export function widestRow(bands: ChartRow[]): number {
  return Math.min(MAX_PLACES, Math.max(0, ...bands.map((_, i) => placeLimit(bands, i))));
}

/** A saved chart as an editable grid. */
export function chartDraftFrom(awards: PointAward[]): ChartDraft {
  if (awards.length === 0) return blankChart();
  const bands = chartBands(awards);
  const places = Math.max(1, ...bands.map((b) => b.points.length));
  return {
    places,
    bands: bands.map((b) => ({
      minEntries: String(b.minEntries),
      points: Array.from({ length: places }, (_, i) => (b.points[i] ? String(b.points[i]) : '')),
    })),
  };
}

/** The grid as award rows, or the reason it cannot be saved. */
export function awardsFromChart(chart: ChartDraft): { awards: PointAward[] } | { error: string } {
  const awards: PointAward[] = [];
  const { bands } = chart;
  for (let b = 0; b < bands.length; b++) {
    const minEntries = wholeNumber(bands[b].minEntries);
    if (minEntries === null) {
      return { error: 'Every row needs a class size that is a whole number of horses, 1 or more.' };
    }
    const previous = b > 0 ? wholeNumber(bands[b - 1].minEntries) : null;
    if (previous !== null && minEntries <= previous) {
      return { error: `Rows must run from the smallest classes to the largest: row ${b + 1} starts at ${minEntries}, which is not after row ${b}.` };
    }
    const range = rangeText(bands, b);
    // Only the cells on screen: a place past the row's range is shown blank and
    // greyed out, so it is not what anybody is saving.
    const limit = placeLimit(bands, b);
    let paid = 0;
    for (let i = 0; i < Math.min(chart.places, limit); i++) {
      const raw = (bands[b].points[i] ?? '').trim();
      if (!raw) continue;
      const points = Number(raw);
      if (!Number.isFinite(points) || points < 0) {
        return { error: `${ordinal(i + 1)} place in classes of ${range} is not a number of points.` };
      }
      if (points > 0) {
        awards.push({ min_entries: minEntries, place: i + 1, points });
        paid += 1;
      }
    }
    // A row with nothing in it is not saved, and the row above would then
    // stretch over its range -- so a class that was meant to earn nothing
    // would quietly earn the row above's points.
    if (paid === 0) {
      return { error: `Classes of ${range} have no points. Give their row some, or remove it.` };
    }
  }
  if (awards.length === 0) return { error: 'Enter the points for at least one place.' };
  return { awards };
}

/** Type into one cell. */
export function setChartCell(chart: ChartDraft, bandIndex: number, place: number, value: string): ChartDraft {
  return {
    ...chart,
    bands: chart.bands.map((b, i) =>
      i === bandIndex ? { ...b, points: b.points.map((p, j) => (j === place ? value : p)) } : b,
    ),
  };
}

/** Where a row starts. Neither this nor `setChartTo` clears a cell: a cell past
 *  a row's range is greyed out and not saved, but it keeps what was typed --
 *  typing "14" goes through "1" on the way, and that must not wipe the row it
 *  briefly narrowed. */
export function setChartFrom(chart: ChartDraft, bandIndex: number, value: string): ChartDraft {
  return {
    ...chart,
    bands: chart.bands.map((b, i) => (i === bandIndex ? { ...b, minEntries: value } : b)),
  };
}

/** Where a row ends is where the next one starts, less one -- so typing the end
 *  of 3–4 starts the next row at 5. */
export function setChartTo(chart: ChartDraft, bandIndex: number, value: string): ChartDraft {
  if (bandIndex + 1 >= chart.bands.length) return chart;
  const top = Number(value);
  const nextFrom = value.trim() === '' || !Number.isFinite(top) ? '' : String(Math.trunc(top) + 1);
  return {
    ...chart,
    bands: chart.bands.map((b, i) => (i === bandIndex + 1 ? { ...b, minEntries: nextFrom } : b)),
  };
}

/** Widen or narrow every row to `places` columns, within what any row may pay. */
export function setChartPlaces(chart: ChartDraft, places: number): ChartDraft {
  if (places < 1 || places > widestRow(chart.bands)) return chart;
  return {
    ...chart,
    places,
    bands: chart.bands.map((b) => ({
      ...b,
      points: Array.from({ length: places }, (_, i) => b.points[i] ?? ''),
    })),
  };
}

/** The next class size up, and one more place column -- a printed chart
 *  usually pays one more place per range, so building one row by row keeps the
 *  grid as wide as it needs and no wider. */
export function addChartBand(chart: ChartDraft): ChartDraft {
  const highest = Math.max(0, ...chart.bands.map((b) => Number(b.minEntries) || 0));
  const minEntries = highest + 1;
  const places = Math.min(MAX_PLACES, Math.max(chart.places, Math.min(chart.places + 1, minEntries)));
  const widen = (points: string[]) => Array.from({ length: places }, (_, i) => points[i] ?? '');
  return {
    places,
    bands: [
      ...chart.bands.map((b) => ({ ...b, points: widen(b.points) })),
      { minEntries: String(minEntries), points: widen([]) },
    ],
  };
}

/** Take a row out. A chart keeps at least one. */
export function removeChartBand(chart: ChartDraft, index: number): ChartDraft {
  return chart.bands.length > 1 ? { ...chart, bands: chart.bands.filter((_, i) => i !== index) } : chart;
}
