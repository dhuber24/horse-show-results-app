/**
 * Narrowing a show's results by who and what.
 *
 * The public Results page and the Show Results report (Show Record) offer the
 * same fields — Name, Back #, Horse, Class — and a *My classes* toggle for a
 * signed-in exhibitor. Both read them through these, so the two cannot come to
 * disagree about what "Back # 14" finds.
 *
 * **Every field filled in must match the same placing.** "Name: Reed, Horse:
 * Dusty" finds the class Ann Reed showed Dusty Gold in, not a class where Reed
 * rode one horse and somebody else rode Dusty. The single search box this
 * replaced matched across the whole class, which found the second.
 */

/** The words of a query, lower-cased. */
export function queryWords(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

type Cell = string | number | null | undefined;

/**
 * Every word typed appears in one of the values, in any order — "smith jane"
 * finds "Jane A. Smith". An empty query matches everything.
 *
 * A word that is all digits matches a **whole number** only: "12" finds class
 * 12, class 12A and "Jun 12", and not class 112 or 120. Searching a class
 * number by substring listed every class with that digit in it.
 */
export function matchesWords(query: string, ...values: Cell[]): boolean {
  const words = queryWords(query);
  if (words.length === 0) return true;
  const hay = values
    .filter((v) => v !== null && v !== undefined && v !== '')
    .join('   ')
    .toLowerCase();
  return words.every((word) =>
    /^\d+$/.test(word) ? new RegExp(`(^|\\D)${word}(?!\\d)`).test(hay) : hay.includes(word),
  );
}

/**
 * The whole value, as a back number is read — 14 does not find 142, a "#" in
 * front is ignored, and so is case. An empty query matches everything; a
 * missing value matches nothing.
 */
export function matchesWhole(query: string, value: Cell): boolean {
  const wanted = query.trim().replace(/^#\s*/, '').toLowerCase();
  if (!wanted) return true;
  if (value === null || value === undefined) return false;
  return String(value).trim().replace(/^#\s*/, '').toLowerCase() === wanted;
}

// ── The public Results page ───────────────────────────────────────────────────

export type ResultsFilterValues = {
  name: string;
  backNumber: string;
  horse: string;
  className: string;
};

export const NO_FILTERS: ResultsFilterValues = { name: '', backNumber: '', horse: '', className: '' };

export type FilterableClass = {
  id: string;
  class_number: string;
  class_name: string;
  class_date: string;
};

export type FilterablePlacing = {
  /** Off the `results-index` payload; absent on one served before it carried it. */
  entry_id?: string;
  back_number: number | null;
  exhibitor_name: string;
  horse_name: string | null;
};

/** The reader's own entries at the show — `fetchMyShowEntries`. */
export type MyEntries = { classIds: ReadonlySet<string>; entryIds: ReadonlySet<string> };

/** "Sat, Jun 13" from a `YYYY-MM-DD`, read as a calendar date, not a UTC instant. */
export function formatClassDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

/** A field about a person or a horse is filled in — so a class is listed only
 *  for a placing that matches, and a class with no placings cannot be. */
export function hasPlacingFilter(f: ResultsFilterValues): boolean {
  return Boolean(f.name.trim() || f.backNumber.trim() || f.horse.trim());
}

export function isFiltering(f: ResultsFilterValues, mineOnly: boolean): boolean {
  return mineOnly || hasPlacingFilter(f) || Boolean(f.className.trim());
}

export function placingMatches(p: FilterablePlacing, f: ResultsFilterValues): boolean {
  return (
    matchesWords(f.name, p.exhibitor_name) &&
    matchesWhole(f.backNumber, p.back_number) &&
    matchesWords(f.horse, p.horse_name)
  );
}

export function classMatches(c: FilterableClass, f: ResultsFilterValues): boolean {
  return matchesWords(f.className, c.class_number, c.class_name, c.class_date, formatClassDate(c.class_date));
}

/**
 * The classes to list, in the order given, and the placings to show under each.
 *
 * With a name, back number or horse filled in, a class is listed for the
 * placings that match and shows them. With only *My classes* on, a class is
 * listed because the reader is entered in it — posted or not, since "which of
 * mine are still to come" is half the question — and shows the reader's own
 * placings. `mine` is null when the toggle is off.
 */
export function filterResults<C extends FilterableClass, P extends FilterablePlacing>(
  classes: C[],
  resultsIndex: Record<string, P[]>,
  filters: ResultsFilterValues,
  mine: MyEntries | null,
): { classes: C[]; hits: Record<string, P[]> } {
  const byPlacing = hasPlacingFilter(filters);
  const listed: C[] = [];
  const hits: Record<string, P[]> = {};

  for (const c of classes) {
    if (mine && !mine.classIds.has(c.id)) continue;
    if (!classMatches(c, filters)) continue;
    const placings = resultsIndex[c.id] ?? [];
    if (byPlacing) {
      const matched = placings.filter((p) => placingMatches(p, filters));
      if (matched.length === 0) continue;
      hits[c.id] = matched;
    } else if (mine) {
      hits[c.id] = placings.filter((p) => p.entry_id !== undefined && mine.entryIds.has(p.entry_id));
    }
    listed.push(c);
  }
  return { classes: listed, hits };
}
