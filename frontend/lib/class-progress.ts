/**
 * Where each class stands on a running show's day, for the public schedule.
 *
 * Read off what has actually happened, never off a setting. Two things record
 * that a class has run — the gate steward's buttons (`classes.gate_status`)
 * and the office posting its results (`classes.results_published_at`) — and a
 * show may use either, both, or one in the morning and the other after lunch.
 * The badge used to read the gate alone, so a show the gate stopped working
 * left its first class "In the ring" all day while the results went up behind
 * it. A "do we have a gate steward" switch would only have moved the failure
 * to the show that has one on Saturday and not on Sunday.
 *
 * The rules, strongest evidence first:
 *
 * - **Done**: the gate marked it done, or its results are posted — the same
 *   test `class_completed` in `backend/self_entry.py` applies — **or a later
 *   class in the same day and ring has finished.** A ring runs its classes in
 *   order, so a posted class 7 means classes 1 to 6 are over, posted or not.
 *   That is what keeps the badge moving when the office posts in batches, and
 *   what clears a start the steward never marked done. A class never started
 *   at the gate is also done once a later one has *started*.
 * - **In the ring**: started at the gate, and nothing after it finished.
 *   **Several classes in one ring can be in the ring at once** — classes that
 *   run together, which the gate starts alongside each other — so a later
 *   class *starting* does not end one already going; the gate's own start
 *   closes the classes ahead of it when they are not running together. Only
 *   the gate says a class has *started*; without one there is no honest way
 *   to know, so no class reads "In the ring" rather than a guess that sends
 *   somebody to the wrong arena.
 * - **Up next**: the first class in its day and ring after everything above.
 *
 * Every lane — a day in one ring — is read in the order it is handed over,
 * which is the running order (`GET /shows/{id}/classes/` sorts by day then
 * `sort_order`, the order the gate's own on-deck rule uses). Nothing here
 * sorts.
 */

export type ClassProgress = 'in_ring' | 'up_next' | 'done';

export type ProgressClass = {
  id: string;
  class_date: string;
  ring_name: string | null;
  gate_status: string;
  results_published_at?: string | null;
};

function finished(c: ProgressClass): boolean {
  return c.gate_status === 'done' || c.results_published_at != null;
}

/** The progress of every class that has one; a class with none is absent. */
export function classProgress(classes: ProgressClass[]): Map<string, ClassProgress> {
  const lanes = new Map<string, ProgressClass[]>();
  for (const c of classes) {
    const key = `${c.class_date}|${c.ring_name ?? ''}`;
    const lane = lanes.get(key);
    if (lane) lane.push(c);
    else lanes.set(key, [c]);
  }

  const progress = new Map<string, ClassProgress>();
  for (const lane of lanes.values()) {
    // The furthest class the ring is known to have reached, and the furthest
    // it is known to have finished.
    let reached = -1;
    let lastFinished = -1;
    lane.forEach((c, i) => {
      if (finished(c)) lastFinished = i;
      if (finished(c) || c.gate_status === 'in_progress') reached = i;
    });

    lane.forEach((c, i) => {
      if (finished(c) || i < lastFinished) progress.set(c.id, 'done');
      else if (c.gate_status === 'in_progress') progress.set(c.id, 'in_ring');
      else if (i < reached) progress.set(c.id, 'done');
    });

    const next = lane[reached + 1];
    if (next) progress.set(next.id, 'up_next');
  }
  return progress;
}
