/**
 * Reading a schedule that is already in discipline-then-division order.
 *
 * The order itself is the backend's: `_renumber_classes` sorts every show by
 * day, then discipline, then division, on every create and delete, so the class
 * numbers *are* the grouping. Nothing here sorts anything — these helpers only
 * describe an order that has already been decided, which is the whole point.
 */

/** The placeholder a class lands in when nothing about its name says where it
 *  belongs (`_get_or_create_unassigned` in the classes router). It sorts last
 *  on both axes whatever its name would do alphabetically — a bucket of things
 *  nobody has classified is the tail of a programme, not the middle of one. */
export const UNASSIGNED_LABEL = 'Unassigned';

/**
 * Consecutive items sharing a key, in the order they were handed over.
 *
 * Runs rather than buckets, and that distinction is load-bearing. A bucket
 * would pull class 14 up under a heading printed at class 1 — the published
 * running order rewritten by a display, which is exactly what `class_number`
 * must never suffer. A run describes the order instead, so if a discipline
 * really does run twice in a day it gets two headings and both are true.
 */
export function runsOf<T>(items: T[], keyOf: (item: T) => string): { key: string; items: T[] }[] {
  const runs: { key: string; items: T[] }[] = [];
  for (const item of items) {
    const key = keyOf(item);
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.items.push(item);
    else runs.push({ key, items: [item] });
  }
  return runs;
}
