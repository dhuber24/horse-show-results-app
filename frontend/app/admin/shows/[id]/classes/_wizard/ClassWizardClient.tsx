'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DraggableProvided,
  type DropResult,
} from '@hello-pangea/dnd';
import { useRegisterStepAutosave } from '../../setup/_lib/StepAutosave';

export type StandardItem = {
  id: string;
  show_type_id?: string | null;
  name: string;
  sort_order: number;
  default_score_type?: string;
};

export type DisciplineItem = {
  id: string;
  name: string;
  sort_order: number | null;
  default_score_type: string;
  class_count?: number;
};

export type DivisionItem = {
  id: string;
  name: string;
  sort_order: number | null;
  class_count?: number;
  discipline_ids: string[];
};

export type ClassItem = {
  id: string;
  show_id: string;
  ring_id: string | null;
  discipline_id: string;
  division_id: string;
  class_number: string;
  class_name: string;
  class_date: string;
  status: string;
  score_type: string;
  entry_fee_cents: number;
  /** Entered by placing first or second in a qualifying class rather than by
   *  signing up (migration 129). Seeded from the class name when the class is
   *  created; the "Must qualify" box on the class list is where a guess gets
   *  corrected. */
  entered_by_qualification: boolean;
  sort_order: number | null;
  /** Entries on this class, from the class list payload. Read only to say why a
   *  class cannot be swept up in a bulk delete — a class cascades to its
   *  entries, and forty ticks is not the deliberate act one Delete button is. */
  entry_count?: number;
};

const COLORS = {
  text: 'var(--foreground)',
  muted: 'var(--muted)',
  border: 'var(--border)',
  borderSoft: 'var(--bg-subtle)',
  bg: 'var(--surface)',
  highlight: 'var(--warning-bg)',
  warn: 'var(--text-deep)',
  warnSoft: 'var(--warning-bg)',
  done: 'var(--success)',
} as const;

/** Which of the grid's two axes something is about. */
type Axis = 'discipline' | 'division';

/** The by-name form's "add a new one" row in a discipline or division picker.
 *  Never a stored value — see the note where it is handled. */
const ADD_AXIS_OPTION = '__add__';

/** What each axis is called: the picker's field label, and the word for one. */
const AXIS_COPY: Record<Axis, { singular: string; noun: string }> = {
  discipline: { singular: 'Discipline', noun: 'discipline' },
  division: { singular: 'Division', noun: 'division' },
};

/** Names are matched on case and surrounding space alone, the same comparison
 *  the bulk create endpoints dedupe on. */
function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * One column or row the picker offers.
 *
 * `id` is the show's own `disciplines` / `divisions` row **when this show has
 * one** — and null for a name that exists only in the standard library. That is
 * the whole of what made the old two-step flow necessary: a library name had to
 * be turned into a show row on a screen of its own before the grid would offer
 * the cell. The picker offers every cell now and the row is created on the click
 * that needs it, so "add the discipline" stops being a thing anybody does.
 */
type AxisOption = {
  /** Normalised name. Stable across a create, which the id is not. */
  key: string;
  name: string;
  id: string | null;
  /** Classes on this show using it — counted from the loaded class list rather
   *  than read off the axis endpoint's `class_count`. The client holds every
   *  class for the show, so the count is exact, and it cannot go stale behind a
   *  class delete that only re-reads the classes. */
  classCount: number;
  inLibrary: boolean;
};

/**
 * The show's own rows merged with the standard library, alphabetically.
 *
 * Alphabetical rather than by `sort_order`, because a library name has no
 * position on this show and a grid of thirty columns is read by hunting for a
 * name. Where both carry a name, the show's spelling wins: it is what its
 * existing classes were named from.
 */
function mergeAxisOptions(
  showRows: { id: string; name: string }[],
  library: StandardItem[],
  classCountByRowId: Map<string, number>,
): AxisOption[] {
  const byKey = new Map<string, AxisOption>();
  for (const row of showRows) {
    const key = normalizeName(row.name);
    if (!key) continue;
    byKey.set(key, {
      key,
      name: row.name.trim(),
      id: row.id,
      classCount: classCountByRowId.get(row.id) ?? 0,
      inLibrary: false,
    });
  }
  for (const item of library) {
    const key = normalizeName(item.name);
    if (!key) continue;
    const held = byKey.get(key);
    if (held) byKey.set(key, { ...held, inLibrary: true });
    else byKey.set(key, { key, name: item.name.trim(), id: null, classCount: 0, inLibrary: true });
  }
  return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Mirrors `rules.disciplines.entered_by_qualification` on the backend: the two
 * shapes a class you place into is named on a real schedule. Only a starting
 * guess for the "Must qualify" box on a class somebody is naming — once they
 * tick or untick it themselves, their answer stands.
 */
const QUALIFYING_NAME_RE =
  /\bgrand\s*(?:&|and|\/)\s*reserve\b|\breserve\s*(?:&|and|\/)\s*grand\b|\bgrand\s+champion(?:ship)?\b|\breserve\s+champion(?:ship)?\b/i;

function looksLikeQualifyingClass(name: string): boolean {
  return QUALIFYING_NAME_RE.test(name);
}

/**
 * The Class Builder: one screen, with the grid on it.
 *
 * It used to be three screens behind a progress bar — pick the disciplines and
 * save, pick the divisions and save, and only then reach the grid that crosses
 * the two. That made somebody learn a sequence in order to answer one question:
 * a discipline is a column of this grid and a division is a row of it, neither
 * is read anywhere else in setup, and a show is not any closer to having a
 * schedule for having named either. So the two pickers are a panel over the
 * grid they draw, opened from the axis they change, and a pick saves on the
 * click the same way a grid cell does.
 *
 * Nothing was dropped in the collapse. The standard libraries, custom names and
 * removal are all still here — a scroll from the grid rather than a step away
 * from it, and with the grid redrawing behind the panel as they are used, which
 * is the one thing the separate steps could never show.
 */
export default function ClassWizardClient({
  showId,
  showStartDate,
  showEndDate,
  initialDisciplines,
  initialDivisions,
  initialClasses,
  standardDisciplines,
  standardDivisions,
}: {
  showId: string;
  showStartDate: string;
  showEndDate: string;
  initialDisciplines: DisciplineItem[];
  initialDivisions: DivisionItem[];
  initialClasses: ClassItem[];
  standardDisciplines: StandardItem[];
  standardDivisions: StandardItem[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [disciplines, setDisciplines] = useState<DisciplineItem[]>(initialDisciplines);
  const [divisions, setDivisions] = useState<DivisionItem[]>(initialDivisions);
  const [classes, setClasses] = useState<ClassItem[]>(initialClasses);

  return (
    <div className="space-y-4">
      {error && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--error)', backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}
          role="alert"
        >
          {error}
        </div>
      )}

      <ClassBuilder
        showId={showId}
        showStartDate={showStartDate}
        showEndDate={showEndDate}
        disciplines={disciplines}
        divisions={divisions}
        classes={classes}
        standardDisciplines={standardDisciplines}
        standardDivisions={standardDivisions}
        busy={busy}
        setBusy={setBusy}
        setError={setError}
        onDisciplinesChanged={setDisciplines}
        onDivisionsChanged={setDivisions}
        onClassesChanged={setClasses}
      />
    </div>
  );
}

// ── Building the classes ───────────────────────────────────────────────────────

/** Keyed on names rather than ids: a cell the show has never used has no ids to
 *  key on, and the id a name gets is decided by the click that creates it. */
function cellKey(disciplineKey: string, divisionKey: string): string {
  return `${disciplineKey}::${divisionKey}`;
}

function enumerateDates(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(start + 'T00:00:00');
  const last = new Date(end + 'T00:00:00');
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

/** Orders a class list the way the backend numbers it: by day, then position. */
function scheduleOrder(rows: ClassItem[]): ClassItem[] {
  return [...rows].sort(
    (a, b) =>
      a.class_date.localeCompare(b.class_date) || (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );
}

/**
 * A scroll box with a second horizontal scrollbar along its top edge.
 *
 * The class grid is as wide as the show has disciplines, and a show with
 * twenty-two of them is several screens across. The box's own scrollbar runs
 * along its bottom edge, below the fold on any grid worth scrolling, so the one
 * on top mirrors it and the two are kept in step both ways.
 *
 * The box also scrolls vertically inside itself, capped at most of the
 * viewport, rather than growing with the page. That is what lets the header row
 * stick: `position: sticky` pins to the nearest scrolling ancestor, and a box
 * that scrolls sideways already is one — so the discipline names can only stay
 * in view while the divisions scroll past if that same box scrolls them.
 */
function DualScrollBox({ children, maxHeight }: { children: React.ReactNode; maxHeight: string }) {
  const topRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const top = topRef.current;
    const box = boxRef.current;
    if (!top || !box) return;

    const measure = () => {
      setScrollWidth(box.scrollWidth);
      setOverflowing(box.scrollWidth > box.clientWidth + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    if (box.firstElementChild) observer.observe(box.firstElementChild);

    // Each side writes only when the other has actually moved. Setting the
    // same scrollLeft fires no scroll event, so the pair settles rather than
    // bouncing off each other.
    const fromBox = () => {
      if (Math.abs(top.scrollLeft - box.scrollLeft) > 1) top.scrollLeft = box.scrollLeft;
    };
    const fromTop = () => {
      if (Math.abs(box.scrollLeft - top.scrollLeft) > 1) box.scrollLeft = top.scrollLeft;
    };
    box.addEventListener('scroll', fromBox, { passive: true });
    top.addEventListener('scroll', fromTop, { passive: true });
    return () => {
      observer.disconnect();
      box.removeEventListener('scroll', fromBox);
      top.removeEventListener('scroll', fromTop);
    };
  }, []);

  return (
    <div>
      <div
        ref={topRef}
        hidden={!overflowing}
        aria-hidden="true"
        className="overflow-x-auto overflow-y-hidden mb-1"
      >
        <div style={{ width: scrollWidth, height: 1 }} />
      </div>
      <div ref={boxRef} className="overflow-auto" style={{ maxHeight }}>
        {children}
      </div>
    </div>
  );
}

function ClassBuilder({
  showId,
  showStartDate,
  showEndDate,
  disciplines,
  divisions,
  classes,
  standardDisciplines,
  standardDivisions,
  busy,
  setBusy,
  setError,
  onDisciplinesChanged,
  onDivisionsChanged,
  onClassesChanged,
}: {
  showId: string;
  showStartDate: string;
  showEndDate: string;
  disciplines: DisciplineItem[];
  divisions: DivisionItem[];
  classes: ClassItem[];
  standardDisciplines: StandardItem[];
  standardDivisions: StandardItem[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (msg: string | null) => void;
  onDisciplinesChanged: (rows: DisciplineItem[]) => void;
  onDivisionsChanged: (rows: DivisionItem[]) => void;
  onClassesChanged: (rows: ClassItem[]) => void;
}) {
  const onChanged = onClassesChanged;
  const [classDate, setClassDate] = useState(showStartDate);
  // The Quick Class Picker is open by default: it is the tool this step is for,
  // and it is capped at 70vh, so an open one does not run away with the page.
  // It folds because a schedule of a hundred classes is read below it.
  const [pickerOpen, setPickerOpen] = useState(true);
  // The schedule can run to hundreds of rows; it lives below the picker and
  // stays folded so the grid — the thing being worked in — owns the screen.
  // Adding a class by name opens it, because the point of that form is the row
  // it produces.
  const [listOpen, setListOpen] = useState(false);
  // Filter over the class list. A show runs to hundreds of classes and the one
  // being removed is found by name, not by scrolling a day at a time.
  const [query, setQuery] = useState('');
  // Ticked classes, for the bulk delete. Held by id rather than by position so
  // the set survives filtering and reordering.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  // The class the by-name form just added, and the sentence saying where it
  // landed. The form closes on a save, so the confirmation has to be out here.
  const [added, setAdded] = useState<{ id: string; message: string } | null>(null);
  // Date-qualified cell keys (`${classDate}::${disciplineId}::${divisionId}`)
  // for picks that have been clicked but whose create hasn't reconciled into
  // `classes` yet — drives the in-flight "…" marker on the grid.
  const [queuedKeys, setQueuedKeys] = useState<Set<string>>(new Set());
  const [savingOrder, setSavingOrder] = useState(false);
  // Classes whose "Must qualify" box is mid-save. Per row rather than the
  // step-wide `busy`, so ticking one box does not freeze every other control.
  const [pendingQualify, setPendingQualify] = useState<Set<string>>(new Set());
  // Opening the by-name form with the Grand & Reserve shortcut bumps this, so
  // the form can prefill itself without the step reaching into its state.
  const [namedClassPreset, setNamedClassPreset] = useState<{ kind: 'blank' | 'grand'; nonce: number } | null>(null);

  // Serialize class creates: clicking "+" enqueues a job and a single drainer
  // POSTs them one at a time, so the backend's per-create renumber can't race
  // with itself when the secretary clicks several cells quickly.
  const queueRef = useRef<
    { discipline: AxisOption; division: AxisOption; classDate: string }[]
  >([]);
  const processingRef = useRef(false);
  // Leaving the step waits for the cells still saving. The finish button used
  // to be disabled while the queue drained; with one screen there is no finish
  // button, and the way out is the wizard's own Back / Next, which flushes what
  // the step has in flight before it navigates.
  //
  // Written as a wait on the queue rather than as an awaited drain promise:
  // a click can legitimately start a *new* drain while the previous one is
  // still finishing its refresh, so "the drain that is running" is not one
  // promise to hold. It is a no-op when nothing is queued — the contract every
  // step flush has to keep — and gives up after a while rather than trapping
  // somebody on the step behind a request that is never coming back.
  useRegisterStepAutosave(async () => {
    const deadline = Date.now() + 15_000;
    while ((queueRef.current.length > 0 || processingRef.current) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });

  const dates = useMemo(() => enumerateDates(showStartDate, showEndDate), [showStartDate, showEndDate]);

  // Every column and every row the picker offers: what this show already uses,
  // plus its show type's standard library, alphabetically. A name the show has
  // never used is an ordinary cell — clicking it creates the row it needs.
  const classesPerAxisRow = useMemo(() => {
    const byDiscipline = new Map<string, number>();
    const byDivision = new Map<string, number>();
    for (const c of classes) {
      byDiscipline.set(c.discipline_id, (byDiscipline.get(c.discipline_id) ?? 0) + 1);
      byDivision.set(c.division_id, (byDivision.get(c.division_id) ?? 0) + 1);
    }
    return { discipline: byDiscipline, division: byDivision };
  }, [classes]);

  const disciplineOptions = useMemo(
    () => mergeAxisOptions(disciplines, standardDisciplines, classesPerAxisRow.discipline),
    [disciplines, standardDisciplines, classesPerAxisRow.discipline],
  );
  const divisionOptions = useMemo(
    () => mergeAxisOptions(divisions, standardDivisions, classesPerAxisRow.division),
    [divisions, standardDivisions, classesPerAxisRow.division],
  );

  // A class stores ids; the grid is keyed on names. These two turn one into the
  // other so an existing class can mark its cell ✓.
  const disciplineKeyById = useMemo(
    () => new Map(disciplines.map((d) => [d.id, normalizeName(d.name)])),
    [disciplines],
  );
  const divisionKeyById = useMemo(
    () => new Map(divisions.map((d) => [d.id, normalizeName(d.name)])),
    [divisions],
  );

  // Existing-class (discipline, division) pairs scoped to the selected date.
  // Cells in that set are disabled in the grid so the secretary can't queue a
  // duplicate for that day. A class entered by qualifying does not count: a
  // Grand & Reserve class filed under Halter × Amateur is a call-back from the
  // ordinary Amateur Halter class, not that class, and adding one must not
  // make the grid claim the other already exists.
  const takenForDate = useMemo(() => {
    const taken = new Set<string>();
    for (const c of classes) {
      if (c.class_date !== classDate || c.entered_by_qualification) continue;
      const dk = disciplineKeyById.get(c.discipline_id);
      const vk = divisionKeyById.get(c.division_id);
      if (dk && vk) taken.add(cellKey(dk, vk));
    }
    return taken;
  }, [classes, classDate, disciplineKeyById, divisionKeyById]);

  // For the existing-classes display, group by date so a multi-day show
  // doesn't blob into one undifferentiated list.
  const classesByDate = useMemo(() => {
    const byDate = new Map<string, ClassItem[]>();
    for (const c of classes) {
      const arr = byDate.get(c.class_date) ?? [];
      arr.push(c);
      byDate.set(c.class_date, arr);
    }
    for (const arr of byDate.values()) {
      arr.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    }
    return Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [classes]);

  const filtering = query.trim().length > 0;
  // Matched on name, class number and day together, so "halter", "42" and
  // "06-14" all find something without a field picker in front of the box.
  const visibleByDate = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return classesByDate;
    const terms = q.split(/\s+/);
    const hit = (c: ClassItem) => {
      const hay = `${c.class_name} #${c.class_number} ${c.class_date}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    };
    return classesByDate
      .map(([date, rows]) => [date, rows.filter(hit)] as [string, ClassItem[]])
      .filter(([, rows]) => rows.length > 0);
  }, [classesByDate, query]);

  const visibleClasses = useMemo(
    () => visibleByDate.flatMap(([, rows]) => rows),
    [visibleByDate],
  );
  // A class with entries is kept out of the sweep: deleting it takes its
  // entries and placings with it, which is a decision for its own Delete
  // button rather than for one of forty ticks.
  const selectableVisible = useMemo(
    () => visibleClasses.filter((c) => !c.entry_count),
    [visibleClasses],
  );
  const allVisibleSelected =
    selectableVisible.length > 0 && selectableVisible.every((c) => selected.has(c.id));

  // Drop any tick whose class has gone — deleted here, or by somebody else
  // since this page loaded. A stale id would be sent to the bulk delete and
  // come back as "not in this show", naming nothing the secretary can see.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(classes.map((c) => c.id));
      const next = new Set(Array.from(prev).filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [classes]);

  // Bring the row the by-name form just created into view. The list has just
  // been opened underneath a form that closed, so the browser is looking at
  // the wrong part of a long page.
  useEffect(() => {
    if (!added || !listOpen) return;
    const row = document.getElementById(`class-row-${added.id}`);
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [added, listOpen]);

  function toggleSelected(id: string) {
    setConfirmBulk(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function refreshClasses(): Promise<ClassItem[] | null> {
    const res = await fetch(`/api/shows/${showId}/classes`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as ClassItem[];
    onChanged(json);
    return json;
  }

  /**
   * Creating the show's own row for a grid axis.
   *
   * Posted one name at a time to the bulk endpoint rather than to the single
   * create: `/disciplines/bulk` is what infers a score type from the name (a
   * standard row's if it matches one, `_infer_score_type`'s otherwise), and the
   * single create makes the caller state it. A class inherits its score type
   * from its discipline, so guessing it here would be guessing how every class
   * in that column is judged.
   *
   * A new division is offered under every discipline the show has. A new
   * discipline gets no matching backfill and needs none — `POST
   * /shows/{id}/classes` upserts the `(discipline, division)` membership as it
   * creates the class, which is what lets the picker offer every cell.
   *
   * The id comes out of the create's own response rather than a re-read, so a
   * sweep that opens six new columns is six calls rather than twelve. A name
   * the bulk endpoint skipped is one this show already had under a spelling
   * this caller did not know about, and only that falls back to a re-read.
   */
  async function createAxisRow(
    axis: Axis,
    name: string,
    disciplineIds: string[],
  ): Promise<string | null> {
    const path = axis === 'discipline' ? 'disciplines' : 'divisions';
    const body: Record<string, unknown> = { names: [name] };
    if (axis === 'division') body.discipline_ids = disciplineIds;
    const wanted = normalizeName(name);
    try {
      const res = await fetch(`/api/shows/${showId}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.detail || `Failed to add “${name}”.`);
        return null;
      }
      const made = (json as { id: string; name: string }[] | null)?.find(
        (r) => normalizeName(r.name) === wanted,
      );
      if (made) return made.id;
    } catch {
      setError(`Failed to add “${name}”.`);
      return null;
    }
    const rows = await refreshAxis(axis);
    return rows?.find((r) => normalizeName(r.name) === wanted)?.id ?? null;
  }

  /**
   * The show row id for one axis name, creating it if this show has never used
   * it.
   *
   * `known` is what the caller has already resolved on this run, so six cells
   * swept in one new column create that column once. `rows` is the caller's own
   * view of the show — for the drain that is the list from the render the drain
   * started in, which is complete, because the only thing that adds a
   * discipline or a division now is this function.
   */
  async function axisIdFor(
    axis: Axis,
    option: AxisOption,
    rows: { id: string; name: string }[],
    known: Map<string, string>,
    disciplineIds: string[],
  ): Promise<string | null> {
    const held = known.get(option.key);
    if (held) return held;
    if (option.id) {
      known.set(option.key, option.id);
      return option.id;
    }
    const existing = rows.find((r) => normalizeName(r.name) === option.key);
    if (existing) {
      known.set(option.key, existing.id);
      return existing.id;
    }
    const made = await createAxisRow(axis, option.name, disciplineIds);
    if (made) known.set(option.key, made);
    return made;
  }

  /**
   * Taking a column or a row off the picker.
   *
   * Only offered where it changes what is on screen: a show row with no classes
   * whose name the standard library does not carry. A library name is a column
   * whether or not this show has a row for it, so deleting that row would look
   * like nothing happening — and a row with classes is refused by the endpoint
   * anyway. That leaves the case this exists for: a name somebody typed
   * themselves, whose classes have since gone.
   */
  async function removeAxisRow(axis: Axis, id: string) {
    setError(null);
    setBusy(true);
    const path = axis === 'discipline' ? 'disciplines' : 'divisions';
    try {
      const res = await fetch(`/api/shows/${showId}/${path}/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const j = await res.json().catch(() => null);
        setError(j?.detail || `Failed to remove the ${AXIS_COPY[axis].noun}.`);
      }
    } catch {
      setError(`Failed to remove the ${AXIS_COPY[axis].noun}.`);
    } finally {
      setBusy(false);
    }
    await refreshAxis(axis);
  }

  /** Re-reads one axis, so the picker gains the column or row a create just
   *  made. How many classes use it is counted from the class list instead. */
  async function refreshAxis(
    axis: Axis,
  ): Promise<{ id: string; name: string }[] | null> {
    const path = axis === 'discipline' ? 'disciplines' : 'divisions';
    const res = await fetch(`/api/shows/${showId}/${path}`, { cache: 'no-store' });
    if (!res.ok) return null;
    if (axis === 'discipline') {
      const rows = (await res.json()) as DisciplineItem[];
      onDisciplinesChanged(rows);
      return rows;
    }
    const rows = (await res.json()) as DivisionItem[];
    onDivisionsChanged(rows);
    return rows;
  }

  /**
   * The ids for one (discipline, division) pair, creating either row as needed.
   *
   * The by-name form's door onto the same thing the picker's cells do — its
   * pickers offer the standard library too, so it can be filling in a class
   * under a discipline this show has never used.
   */
  async function resolveAxisPair(
    discipline: AxisOption,
    division: AxisOption,
  ): Promise<{ disciplineId: string; divisionId: string } | null> {
    const known = { discipline: new Map<string, string>(), division: new Map<string, string>() };
    const disciplineIds = disciplines.map((d) => d.id);
    const disciplineId = await axisIdFor('discipline', discipline, disciplines, known.discipline, disciplineIds);
    if (!disciplineId) return null;
    const divisionId = await axisIdFor(
      'division',
      division,
      divisions,
      known.division,
      Array.from(new Set([...disciplineIds, disciplineId])),
    );
    if (!divisionId) return null;
    if (!discipline.id) await refreshAxis('discipline');
    if (!division.id) await refreshAxis('division');
    return { disciplineId, divisionId };
  }

  /** Saves a whole-show running order and renumbers to match. Numbers run
   *  1..N across the whole show, ordered by date then position, so any move
   *  persists the full ordered id list. */
  async function saveOrder(ordered: ClassItem[]) {
    // Optimistically renumber to match the new global position so the list
    // doesn't flash stale numbers while the save is in flight.
    const renumbered = ordered.map((c, i) => ({
      ...c,
      sort_order: i + 1,
      class_number: String(i + 1),
    }));
    onChanged(renumbered);

    setSavingOrder(true);
    try {
      const res = await fetch(`/api/shows/${showId}/classes/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ class_ids: renumbered.map((c) => c.id) }),
      });
      if (!res.ok && res.status !== 204) {
        const j = await res.json().catch(() => null);
        setError(j?.detail || 'Failed to save the new order.');
        await refreshClasses();
      }
    } finally {
      setSavingOrder(false);
    }
  }

  // Drag-and-drop reorder, scoped to a single day.
  async function handleDragEnd(result: DropResult) {
    const { source, destination } = result;
    if (!destination) return;
    // Days are independent Droppables — ignore cross-day drops.
    if (destination.droppableId !== source.droppableId) return;
    if (destination.index === source.index) return;

    const date = source.droppableId;
    const reordered: ClassItem[] = [];
    for (const [d, dayClasses] of classesByDate) {
      if (d === date) {
        const arr = [...dayClasses];
        const [moved] = arr.splice(source.index, 1);
        arr.splice(destination.index, 0, moved);
        reordered.push(...arr);
      } else {
        reordered.push(...dayClasses);
      }
    }
    setError(null);
    await saveOrder(reordered);
  }

  // Clicking a "+" cell adds that class immediately — no separate confirm step,
  // and no separate step to put its column or its row on the show first.
  function addCell(discipline: AxisOption, division: AxisOption) {
    const k = cellKey(discipline.key, division.key);
    const dk = `${classDate}::${k}`;
    if (takenForDate.has(k) || queuedKeys.has(dk)) return;
    setAdded(null);
    setQueuedKeys((prev) => new Set(prev).add(dk));
    queueRef.current.push({ discipline, division, classDate });
    // Always call it. `drainQueue`'s own `processingRef` guard is what stops a
    // second drainer running alongside the first, and it clears that flag
    // *before* its closing refresh — so a cell clicked during that refresh has
    // to be able to start the next drain. Gating this call on "is a drain in
    // flight" instead loses the click: the running drain's loop has already
    // found the queue empty and exited, and nothing starts another.
    void drainQueue();
  }

  async function drainQueue() {
    if (processingRef.current) return;
    processingRef.current = true;
    setError(null);
    const processed: string[] = [];
    // What this drain has resolved or created, so a sweep down a column the
    // show has never used creates that column once rather than per cell. Seeded
    // empty and carried across the whole loop; `disciplines` / `divisions` from
    // this closure are the rest of the answer, and between them they are
    // complete, because nothing else creates either any more.
    const known = { discipline: new Map<string, string>(), division: new Map<string, string>() };
    const madeAxis = { discipline: false, division: false };
    try {
      while (queueRef.current.length > 0) {
        const job = queueRef.current.shift()!;
        const dk = `${job.classDate}::${cellKey(job.discipline.key, job.division.key)}`;
        const className = `${job.division.name} ${job.discipline.name}`;
        try {
          const disciplineIds = Array.from(
            new Set([...disciplines.map((d) => d.id), ...known.discipline.values()]),
          );
          const disciplineId = await axisIdFor(
            'discipline',
            job.discipline,
            disciplines,
            known.discipline,
            disciplineIds,
          );
          if (!job.discipline.id && disciplineId) madeAxis.discipline = true;
          const divisionId = disciplineId
            ? await axisIdFor(
                'division',
                job.division,
                divisions,
                known.division,
                Array.from(new Set([...disciplineIds, disciplineId])),
              )
            : null;
          if (!job.division.id && divisionId) madeAxis.division = true;
          // `createAxisRow` has already said why on the error banner.
          if (!disciplineId || !divisionId) continue;

          const res = await fetch(`/api/shows/${showId}/classes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              discipline_id: disciplineId,
              division_id: divisionId,
              class_name: className,
              class_date: job.classDate,
              status: 'OPEN',
            }),
          });
          if (!res.ok) {
            const j = await res.json().catch(() => null);
            setError(j?.detail || `Failed to create "${className}".`);
          }
        } catch {
          setError(`Failed to create "${className}".`);
        } finally {
          processed.push(dk);
        }
      }
    } finally {
      processingRef.current = false;
      // One re-read of each axis this drain opened, rather than one per column:
      // the ids came out of the creates themselves, and this is only so the
      // picker's headers know which rows the show now owns.
      if (madeAxis.discipline) await refreshAxis('discipline');
      if (madeAxis.division) await refreshAxis('division');
      await refreshClasses();
      // Drop only the markers this drainer handled. Successful cells are now
      // "taken" via `classes`; failed cells fall back to "+" so they retry.
      // A concurrent drainer keeps its own in-flight markers untouched.
      setQueuedKeys((prev) => {
        const next = new Set(prev);
        for (const dk of processed) next.delete(dk);
        return next;
      });
    }
  }

  /**
   * Tick or untick "Must qualify" on one class.
   *
   * Seeded from the class name when the class is created — "Grand & Reserve
   * Amateur Stallions" is not a class anybody signs up for — but a name is a
   * guess and this is where it gets corrected in either direction. A show that
   * has run a class called "Reserve Champion Trail" as an ordinary open class
   * for twenty years unticks it here and it stays unticked.
   *
   * The consequence is one-sided: ticked, the class disappears from the
   * exhibitor's class picker and `POST /shows/{id}/register` refuses it. The
   * desk keeps entering it, because the office is standing there when the judge
   * calls the horses back. Unticked is simply open entry.
   *
   * Saved optimistically, because a box that waits on a round trip before it
   * shows its own tick reads as a box that did not take the click.
   */
  async function toggleQualification(cls: ClassItem) {
    const next = !cls.entered_by_qualification;
    setError(null);
    setPendingQualify((prev) => new Set(prev).add(cls.id));
    onChanged(classes.map((c) => (c.id === cls.id ? { ...c, entered_by_qualification: next } : c)));
    try {
      const res = await fetch(`/api/shows/${showId}/classes/${cls.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entered_by_qualification: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.detail || `Could not update "${cls.class_name}".`);
        await refreshClasses();
      }
    } catch {
      setError(`Could not update "${cls.class_name}".`);
      await refreshClasses();
    } finally {
      setPendingQualify((prev) => {
        const nextSet = new Set(prev);
        nextSet.delete(cls.id);
        return nextSet;
      });
    }
  }

  async function removeClass(classId: string) {
    setError(null);
    setAdded(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/shows/${showId}/classes/${classId}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        const j = await res.json().catch(() => null);
        setError(j?.detail || 'Failed to delete class.');
        return;
      }
      await refreshClasses();
    } finally {
      setBusy(false);
    }
  }

  /**
   * Delete every ticked class in one request.
   *
   * One at a time works — it is what the Delete on each row does — but every
   * delete renumbers the whole show, so clearing a mis-built schedule was a
   * round trip per class with the numbers shuffling in between. The endpoint is
   * all-or-nothing and refuses a class anybody has entered, so a refusal leaves
   * the ticks alone: the message names the classes to untick.
   */
  async function deleteSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setError(null);
    setAdded(null);
    setBulkBusy(true);
    try {
      const res = await fetch(`/api/shows/${showId}/classes/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ class_ids: ids }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.detail || 'Failed to delete the selected classes.');
        return;
      }
      setSelected(new Set());
      setConfirmBulk(false);
      await refreshClasses();
    } catch {
      setError('Failed to delete the selected classes.');
    } finally {
      setBulkBusy(false);
    }
  }

  const adding = queuedKeys.size > 0;
  // A show type with no standard library and a show that has never used a
  // discipline leaves nothing to draw. The by-name form is the way in.
  const pickerEmpty = disciplineOptions.length === 0 || divisionOptions.length === 0;

  /** Opens the by-name form, or closes it if that button already opened it.
   *  The two buttons sit beside the picker permanently now, so each has to be
   *  able to put away what it opened. */
  function toggleNamedForm(kind: 'blank' | 'grand') {
    setNamedClassPreset((held) =>
      held?.kind === kind ? null : { kind, nonce: Date.now() },
    );
  }

  return (
    <section
      className="p-4 rounded-lg border space-y-4"
      style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
    >
      <ul className="text-xs list-disc pl-4 space-y-1" style={{ color: COLORS.muted }}>
        <li>
          Create classes using the Class Picker to quickly add pre-built
          discipline and division combinations, or use the <strong>+ Add Class</strong>{' '}
          button to manually enter your own class details.
        </li>
        <li>Select a date before using the Class Picker.</li>
        <li>
          Once a class is created, it can be reordered by clicking and dragging it
          to the proper order.
        </li>
        <li>
          Check the <strong>Must Qualify</strong> box for any class that requires
          an exhibitor/horse to qualify; i.e. Grand and Reserve.
        </li>
      </ul>

      {/* ── What this step can do ─────────────────────────────────────────
          Stacked rather than in a row, in the order somebody reaches for
          them: naming a class is the deliberate one-off, and the picker is
          the bulk tool underneath. Each opens directly above the picker, so
          a form never appears under 70vh of grid.

          `inline-flex` so the column is only as wide as its widest label and
          all three buttons match it, rather than three ragged widths or
          three stretched to the page. */}
      <div className="inline-flex flex-col gap-2 items-stretch">
        <button
          type="button"
          onClick={() => toggleNamedForm('blank')}
          aria-expanded={namedClassPreset?.kind === 'blank'}
          title="Name a class yourself and file it under any discipline and division"
          className="text-sm rounded px-3 py-1.5 border text-left"
          style={{
            borderColor: namedClassPreset?.kind === 'blank' ? COLORS.warn : COLORS.border,
            backgroundColor: namedClassPreset?.kind === 'blank' ? COLORS.highlight : 'var(--surface)',
            color: namedClassPreset?.kind === 'blank' ? COLORS.warn : COLORS.text,
          }}
        >
          + Add Class
        </button>
        <button
          type="button"
          onClick={() => toggleNamedForm('grand')}
          aria-expanded={namedClassPreset?.kind === 'grand'}
          className="text-sm rounded px-3 py-1.5 border text-left"
          style={{
            borderColor: namedClassPreset?.kind === 'grand' ? COLORS.warn : COLORS.border,
            backgroundColor: namedClassPreset?.kind === 'grand' ? COLORS.highlight : 'var(--surface)',
            color: namedClassPreset?.kind === 'grand' ? COLORS.warn : COLORS.text,
          }}
          title="A championship class the top placings are called back to — entry is by qualifying"
        >
          + Add a Grand &amp; Reserve Class
        </button>
        <button
          type="button"
          onClick={() => setPickerOpen((open) => !open)}
          aria-expanded={pickerOpen}
          title="The grid of every division crossed with every discipline — click a square to add that class"
          className="text-sm rounded px-3 py-1.5 border text-left"
          style={{
            borderColor: pickerOpen ? COLORS.warn : COLORS.border,
            backgroundColor: pickerOpen ? COLORS.highlight : 'var(--surface)',
            color: pickerOpen ? COLORS.warn : COLORS.text,
            fontWeight: pickerOpen ? 600 : 400,
          }}
        >
          <span aria-hidden>{pickerOpen ? '▾' : '▸'}</span> Quick Class Picker
        </button>
      </div>

      {/* ── A class the picker cannot name ──────────────────────────────
          Above the picker, not below it: the picker is capped at 70vh, so a
          form opened underneath it was off the bottom of the screen and read
          as a button that had done nothing. */}
      {namedClassPreset && (
        <AddNamedClass
          key={namedClassPreset.nonce}
          preset={namedClassPreset.kind}
          showId={showId}
          dates={dates}
          defaultDate={classDate}
          disciplineOptions={disciplineOptions}
          divisionOptions={divisionOptions}
          classes={classes}
          setError={setError}
          resolveAxisPair={resolveAxisPair}
          refreshClasses={refreshClasses}
          saveOrder={saveOrder}
          onClose={() => setNamedClassPreset(null)}
          // A class you have just named is one you want to see on the
          // schedule — so the form closes, the list opens, any filter that
          // would have hidden the new row is cleared, and the page scrolls
          // to it. It used to stay open over a folded list, reporting the
          // save in a line of text above a form nobody needed any more.
          onCreated={(id, message) => {
            setNamedClassPreset(null);
            setQuery('');
            setListOpen(true);
            setAdded({ id, message });
          }}
        />
      )}

      {/* ── The Quick Class Picker ────────────────────────────────────── */}
      {pickerOpen && (
        <div
          className="rounded border p-3 space-y-3"
          style={{ borderColor: COLORS.border, backgroundColor: COLORS.warnSoft }}
        >
          <div className="flex items-end gap-3 flex-wrap">
            <label className="block">
              <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
                Show day
              </span>
              <select
                value={classDate}
                onChange={(e) => setClassDate(e.target.value)}
                className="border rounded px-3 py-2 text-sm"
                style={{ borderColor: COLORS.border, backgroundColor: 'var(--surface)' }}
              >
                {dates.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </label>
            <p className="text-xs" style={{ color: COLORS.muted }}>
              <span style={{ fontWeight: 600 }}>+</span> adds the class ·{' '}
              <span style={{ fontWeight: 600 }}>✓</span> is already a class on this day
            </p>
          </div>

          {pickerEmpty ? (
            <p className="text-sm" style={{ color: COLORS.muted }}>
              This show type has no standard disciplines or divisions to draw a
              grid from. Use <em>+ Add Class</em> — its pickers take a name of your
              own.
            </p>
          ) : (
            <DualScrollBox maxHeight="70vh">
              {/* Separate borders rather than collapsed: a collapsed border belongs
                  to the table, not the cell, so it would scroll away from a
                  sticky header and leave the names floating over the grid. */}
              <table className="text-sm" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead>
                  <tr>
                    <th
                      className="sticky left-0 top-0 z-30 text-left font-semibold pr-3 py-2 border-b align-bottom"
                      style={{ borderColor: COLORS.border, backgroundColor: COLORS.warnSoft, color: COLORS.text }}
                      scope="col"
                    >
                      Division ╲ Discipline
                    </th>
                    {disciplineOptions.map((disc) => (
                      <th
                        key={disc.key}
                        className="sticky top-0 z-20 font-medium text-xs px-2 py-2 border-b text-center align-bottom"
                        style={{
                          borderColor: COLORS.border,
                          backgroundColor: COLORS.warnSoft,
                          color: COLORS.warn,
                          minWidth: '5rem',
                        }}
                        title={disc.name}
                        scope="col"
                      >
                        {disc.name}
                        <AxisRemove
                          axis="discipline"
                          option={disc}
                          busy={busy}
                          onRemove={removeAxisRow}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {divisionOptions.map((div) => (
                    <tr key={div.key}>
                      <th
                        className="sticky left-0 z-10 text-left font-normal pr-3 py-1.5 border-b"
                        style={{
                          borderColor: COLORS.borderSoft,
                          backgroundColor: COLORS.warnSoft,
                          color: COLORS.text,
                        }}
                        scope="row"
                      >
                        {div.name}
                        <AxisRemove
                          axis="division"
                          option={div}
                          busy={busy}
                          onRemove={removeAxisRow}
                        />
                      </th>
                      {disciplineOptions.map((disc) => {
                        const k = cellKey(disc.key, div.key);
                        const taken = takenForDate.has(k);
                        const queued = queuedKeys.has(`${classDate}::${k}`);
                        const disabled = taken || queued;
                        const title = taken
                          ? `${div.name} ${disc.name} is already on the schedule for ${classDate}`
                          : queued
                            ? `Adding ${div.name} ${disc.name}…`
                            : `Add ${div.name} ${disc.name}`;
                        return (
                          <td
                            key={disc.key}
                            className="text-center border-b p-0.5"
                            style={{ borderColor: COLORS.borderSoft }}
                          >
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() => addCell(disc, div)}
                              title={title}
                              aria-label={title}
                              className="w-full text-xs font-medium rounded px-2 py-1"
                              style={{
                                backgroundColor: taken
                                  ? 'var(--border-subtle)'
                                  : queued
                                    ? COLORS.highlight
                                    : 'var(--surface)',
                                color: taken
                                  ? COLORS.muted
                                  : queued
                                    ? COLORS.warn
                                    : COLORS.text,
                                border: queued
                                  ? `1px solid ${COLORS.warn}`
                                  : `1px solid ${COLORS.border}`,
                                cursor: disabled ? 'not-allowed' : 'pointer',
                                minWidth: '3.5rem',
                              }}
                            >
                              {taken ? '✓' : queued ? '…' : '+'}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </DualScrollBox>
          )}

          {adding && (
            <p className="text-xs font-medium pt-1" style={{ color: COLORS.warn }}>
              Adding {queuedKeys.size} class{queuedKeys.size === 1 ? '' : 'es'}…
            </p>
          )}
        </div>
      )}

      {/* ── The schedule so far ───────────────────────────────────────────
          Below the grid and folded by default: a built-out show runs to
          hundreds of classes, and the grid is what the secretary is working
          in. The count in the header is the live feedback that a click
          landed; the ✓ on the grid cell is the other half. */}
      {classes.length === 0 ? (
        <p className="text-sm" style={{ color: COLORS.muted }}>
          No classes yet.
        </p>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => setListOpen((open) => !open)}
            aria-expanded={listOpen}
            className="w-full flex items-center justify-between gap-3 rounded border px-3 py-2 text-sm"
            style={{ borderColor: COLORS.border, backgroundColor: 'var(--surface)', color: COLORS.text }}
          >
            <span className="font-medium">
              <span aria-hidden>{listOpen ? '▾' : '▸'}</span> Classes added ({classes.length})
            </span>
            <span className="text-xs" style={{ color: COLORS.muted }}>
              {listOpen ? 'Hide' : 'Search, reorder, mark Must qualify, or delete'}
            </span>
          </button>

          {listOpen && added && (
            <p className="text-xs mt-3" role="status" style={{ color: COLORS.done }}>
              ✓ {added.message}
            </p>
          )}

          {listOpen && (
            <>
              {/* ── Find and sweep ─────────────────────────────────────────
                  A built show runs to hundreds of classes, so the one being
                  removed is found by typing its name rather than by scrolling
                  a day at a time — and removing twenty of them is one press
                  rather than twenty. */}
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search classes by name, number or day…"
                  aria-label="Search classes"
                  className="text-sm border rounded px-2 py-1.5 flex-1"
                  style={{
                    borderColor: COLORS.border,
                    backgroundColor: 'var(--surface)',
                    color: COLORS.text,
                    minWidth: '14rem',
                  }}
                />
                <span className="text-xs" style={{ color: COLORS.muted }}>
                  {filtering
                    ? `${visibleClasses.length} of ${classes.length}`
                    : `${classes.length} class${classes.length === 1 ? '' : 'es'}`}
                </span>
                {selectableVisible.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmBulk(false);
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (allVisibleSelected) {
                          for (const c of selectableVisible) next.delete(c.id);
                        } else {
                          for (const c of selectableVisible) next.add(c.id);
                        }
                        return next;
                      });
                    }}
                    className="text-xs rounded px-2 py-1.5 border"
                    style={{ borderColor: COLORS.border, color: COLORS.text, backgroundColor: 'var(--surface)' }}
                  >
                    {allVisibleSelected
                      ? `Untick ${selectableVisible.length}`
                      : `Tick ${filtering ? `all ${selectableVisible.length} shown` : `all ${selectableVisible.length}`}`}
                  </button>
                )}
              </div>

              {selected.size > 0 && (
                <div
                  className="mt-2 rounded border px-3 py-2 flex items-center gap-3 flex-wrap text-sm"
                  style={{ borderColor: 'var(--warning-border)', backgroundColor: COLORS.highlight, color: COLORS.text }}
                >
                  <span>
                    <strong>{selected.size}</strong> selected
                    {filtering && selected.size !== visibleClasses.length && (
                      <span className="text-xs" style={{ color: COLORS.muted }}>
                        {' '}— including classes the search is hiding
                      </span>
                    )}
                  </span>
                  {/* Inline confirmation, the way every other destructive
                      control in the admin console asks. */}
                  {confirmBulk ? (
                    <>
                      <span className="text-xs" style={{ color: COLORS.warn }}>
                        Delete {selected.size} class{selected.size === 1 ? '' : 'es'}? This cannot be undone.
                      </span>
                      <button
                        type="button"
                        onClick={deleteSelected}
                        disabled={bulkBusy}
                        className="text-xs rounded px-3 py-1.5 disabled:opacity-50"
                        style={{ backgroundColor: 'var(--error-strong)', color: 'var(--surface)' }}
                      >
                        {bulkBusy ? 'Deleting…' : `Yes, delete ${selected.size}`}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmBulk(false)}
                        disabled={bulkBusy}
                        className="text-xs hover:underline disabled:opacity-50"
                        style={{ color: COLORS.muted }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setConfirmBulk(true)}
                        className="text-xs rounded px-3 py-1.5 border"
                        style={{ borderColor: 'var(--error-strong)', color: 'var(--error-strong)', backgroundColor: 'var(--surface)' }}
                      >
                        Delete selected
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelected(new Set())}
                        className="text-xs hover:underline"
                        style={{ color: COLORS.muted }}
                      >
                        Clear selection
                      </button>
                    </>
                  )}
                </div>
              )}

              <p className="text-xs mt-3" style={{ color: COLORS.muted }}>
                Tick <strong>Must qualify</strong> on a class that is entered by
                qualifying, such as a Grand &amp; Reserve champion class — exhibitors
                can&rsquo;t enter it themselves, and the desk enters the horses called
                back. Every unticked class is open entry.
              </p>

              {filtering && (
                <p className="text-xs mt-2" style={{ color: COLORS.muted }}>
                  Showing matches only — clear the search to drag classes into a
                  new running order.
                </p>
              )}

              {visibleClasses.length === 0 ? (
                <p className="text-sm mt-3" style={{ color: COLORS.muted }}>
                  No class matches “{query.trim()}”.
                </p>
              ) : filtering ? (
                /* Filtered: no dragging. A drop index into a list with rows
                   missing from it would reorder the wrong classes, and a
                   handle that silently does the wrong thing is worse than a
                   handle that is not there. */
                <div className="space-y-3 mt-3">
                  {visibleByDate.map(([date, dayClasses]) => (
                    <div key={date}>
                      <p className="text-xs font-medium mb-1" style={{ color: COLORS.muted }}>
                        {date} — {dayClasses.length} match{dayClasses.length === 1 ? '' : 'es'}
                      </p>
                      <ul className="space-y-1">
                        {dayClasses.map((c) => (
                          <ClassRow
                            key={c.id}
                            cls={c}
                            selected={selected.has(c.id)}
                            onToggleSelect={() => toggleSelected(c.id)}
                            qualifyPending={pendingQualify.has(c.id)}
                            onToggleQualify={() => toggleQualification(c)}
                            onDelete={() => removeClass(c.id)}
                            deleteDisabled={busy}
                            highlighted={added?.id === c.id}
                          />
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <DragDropContext onDragEnd={handleDragEnd}>
                  <div className="space-y-3 mt-3">
                    {classesByDate.map(([date, dayClasses]) => (
                      <div key={date}>
                        <p
                          className="text-xs font-medium mb-1 flex items-center gap-2"
                          style={{ color: COLORS.muted }}
                        >
                          {date} — {dayClasses.length} class
                          {dayClasses.length === 1 ? '' : 'es'}
                          {dayClasses.length > 1 && (
                            <span style={{ color: COLORS.border }}>· drag to reorder</span>
                          )}
                          {savingOrder && (
                            <span style={{ color: COLORS.done }}>· saving…</span>
                          )}
                        </p>
                        <Droppable droppableId={date}>
                          {(dropProvided) => (
                            <ul
                              ref={dropProvided.innerRef}
                              {...dropProvided.droppableProps}
                              className="space-y-1"
                            >
                              {dayClasses.map((c, index) => (
                                <Draggable key={c.id} draggableId={c.id} index={index}>
                                  {(dragProvided, snapshot) => (
                                    <ClassRow
                                      cls={c}
                                      selected={selected.has(c.id)}
                                      onToggleSelect={() => toggleSelected(c.id)}
                                      qualifyPending={pendingQualify.has(c.id)}
                                      onToggleQualify={() => toggleQualification(c)}
                                      onDelete={() => removeClass(c.id)}
                                      deleteDisabled={busy}
                                      highlighted={added?.id === c.id}
                                      drag={{ provided: dragProvided, isDragging: snapshot.isDragging }}
                                    />
                                  )}
                                </Draggable>
                              ))}
                              {dropProvided.placeholder}
                            </ul>
                          )}
                        </Droppable>
                      </div>
                    ))}
                  </div>
                </DragDropContext>
              )}
            </>
          )}
        </div>
      )}

      {/* No footer of its own. Everything on this screen saves on the press
          that makes it, so there is nothing left for a Save to do — and the
          step's own Back / Next sits directly below this box in `StepLayout`.
          The bar that used to be here walked the three inner steps; with one
          screen its only remaining button went where the footer underneath it
          already goes. */}
    </section>
  );
}

/**
 * The picker's options plus the ones typed into the by-name form, alphabetically.
 *
 * Keyed rather than concatenated, because the moment a typed name is saved it
 * becomes a real option too and the form would then be holding both — two
 * `<option>`s under one key, which React reports as duplicate children and
 * which reads on screen as the name listed twice. The saved one wins.
 */
function withLocalOptions(base: AxisOption[], local: AxisOption[]): AxisOption[] {
  const byKey = new Map(base.map((o) => [o.key, o]));
  for (const o of local) if (!byKey.has(o.key)) byKey.set(o.key, o);
  return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
}

// ── Taking a column or a row off the picker ────────────────────────────────────

/**
 * The × on a picker heading — and it is there for one case only.
 *
 * A standard-library name is a column whether or not this show has a row for
 * it, so removing that row would change nothing on screen; a row with classes
 * is refused by the endpoint, and its classes are what somebody actually means
 * to delete. What is left is a name somebody typed themselves whose classes
 * have since gone — an extra column nothing else can now clear. Rendering the ×
 * anywhere else would be a control that mostly does nothing.
 */
function AxisRemove({
  axis,
  option,
  busy,
  onRemove,
}: {
  axis: Axis;
  option: AxisOption;
  busy: boolean;
  onRemove: (axis: Axis, id: string) => Promise<void>;
}) {
  if (!option.id || option.inLibrary || option.classCount > 0) return null;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void onRemove(axis, option.id!)}
      aria-label={`Remove ${option.name}`}
      title={`Remove “${option.name}” — nothing on this show uses it, and it is not a standard ${AXIS_COPY[axis].noun}`}
      className="ml-1 text-xs leading-none align-middle disabled:opacity-40"
      style={{ color: COLORS.muted }}
    >
      ×
    </button>
  );
}

// ── One row of the class list ──────────────────────────────────────────────────

/**
 * A class on the schedule: tick to sweep, tick to mark Must qualify, or delete.
 *
 * One component for both lists. The whole list is draggable and the searched
 * one is not — a drop index into a list with rows filtered out of it moves the
 * wrong classes — and everything else about the row is the same, so the two
 * must not be two pieces of markup that can drift.
 */
function ClassRow({
  cls,
  selected,
  onToggleSelect,
  qualifyPending,
  onToggleQualify,
  onDelete,
  deleteDisabled,
  highlighted,
  drag,
}: {
  cls: ClassItem;
  selected: boolean;
  onToggleSelect: () => void;
  qualifyPending: boolean;
  onToggleQualify: () => void;
  onDelete: () => void;
  deleteDisabled: boolean;
  /** Just added by the by-name form — marked so it can be found in a long list. */
  highlighted: boolean;
  drag?: { provided: DraggableProvided; isDragging: boolean };
}) {
  const entered = cls.entry_count ?? 0;
  return (
    <li
      id={`class-row-${cls.id}`}
      ref={drag?.provided.innerRef}
      {...(drag?.provided.draggableProps ?? {})}
      className="flex items-center justify-between gap-2 text-sm border-b py-1"
      style={{
        borderColor: COLORS.borderSoft,
        backgroundColor: drag?.isDragging || highlighted ? COLORS.highlight : 'transparent',
        ...(drag?.provided.draggableProps.style ?? {}),
      }}
    >
      <span className="flex items-center gap-2 min-w-0" style={{ color: COLORS.text }}>
        <input
          type="checkbox"
          checked={selected}
          disabled={entered > 0}
          onChange={onToggleSelect}
          aria-label={`Select ${cls.class_name}`}
          title={
            entered > 0
              ? `${entered} entr${entered === 1 ? 'y' : 'ies'} in this class — delete it on its own if you mean to lose ${entered === 1 ? 'it' : 'them'}`
              : `Select ${cls.class_name}`
          }
          className="shrink-0"
        />
        {drag && (
          <span
            {...drag.provided.dragHandleProps}
            className="cursor-grab active:cursor-grabbing select-none shrink-0"
            title="Drag to reorder"
            aria-label="Drag to reorder"
            style={{ color: COLORS.border }}
          >
            ⠿
          </span>
        )}
        <span className="font-mono shrink-0" style={{ color: 'var(--accent)' }}>
          #{cls.class_number}
        </span>
        <span className="truncate">{cls.class_name}</span>
        {entered > 0 && (
          <span className="text-xs shrink-0" style={{ color: COLORS.muted }}>
            · {entered} entered
          </span>
        )}
      </span>
      <span className="flex items-center gap-4 shrink-0">
        <label
          className="flex items-center gap-1.5 text-xs cursor-pointer select-none"
          style={{ color: COLORS.text }}
          title="Ticked: entry is by qualifying — the top placings from the qualifying classes are called back, so exhibitors can't enter it themselves (the desk still can). Unticked: open entry."
        >
          <input
            type="checkbox"
            checked={cls.entered_by_qualification}
            disabled={qualifyPending}
            onChange={onToggleQualify}
          />
          Must qualify
        </label>
        <button
          type="button"
          disabled={deleteDisabled}
          onClick={onDelete}
          className="text-xs hover:underline disabled:opacity-50"
          style={{ color: 'var(--error-strong)' }}
        >
          Delete
        </button>
      </span>
    </li>
  );
}

// ── Add a class by name, or a championship class ─────────────────────────────

/**
 * A class the grid cannot name.
 *
 * The grid names every class "{Division} {Discipline}", which is right for an
 * ordinary class and wrong for the ones a show bill names for themselves — a
 * Grand & Reserve champion class above all, which is not a division crossed
 * with a discipline but a call-back from the classes before it. There was no
 * way to add one here at all. So this takes the name as typed, the day, where
 * in that day it runs, and whether entry is by qualifying.
 *
 * Placement is part of the form rather than left to dragging afterwards,
 * because a Grand & Reserve class belongs straight after the classes it calls
 * back from, and dragging it there down a list of a hundred rows is the job
 * nobody finishes. The `grand` preset opens with Halter picked, the name
 * started, "Must qualify" ticked, and the class placed after the last class on
 * that day in the same discipline and division.
 */
function AddNamedClass({
  preset,
  showId,
  dates,
  defaultDate,
  disciplineOptions,
  divisionOptions,
  classes,
  setError,
  resolveAxisPair,
  refreshClasses,
  saveOrder,
  onClose,
  onCreated,
}: {
  preset: 'blank' | 'grand';
  showId: string;
  dates: string[];
  defaultDate: string;
  /** The same alphabetical options the picker draws its columns and rows from —
   *  this show's own plus the standard library — so a class can be filed under
   *  a discipline this show has not used yet. */
  disciplineOptions: AxisOption[];
  divisionOptions: AxisOption[];
  classes: ClassItem[];
  setError: (msg: string | null) => void;
  /** Turns the picked pair into show row ids, creating either row if this show
   *  has never used it. */
  resolveAxisPair: (
    discipline: AxisOption,
    division: AxisOption,
  ) => Promise<{ disciplineId: string; divisionId: string } | null>;
  refreshClasses: () => Promise<ClassItem[] | null>;
  saveOrder: (ordered: ClassItem[]) => Promise<void>;
  onClose: () => void;
  /** The class landed: its id, and where on the schedule it went. */
  onCreated: (classId: string, message: string) => void;
}) {
  // Names typed into a picker's "+ Add a new…" box. Held here rather than
  // written straight to the show: somebody who types a name and then closes the
  // form should not have left a column behind on the grid. `resolveAxisPair`
  // creates it on the save that actually needs it.
  const [localOptions, setLocalOptions] = useState<{ discipline: AxisOption[]; division: AxisOption[] }>({
    discipline: [],
    division: [],
  });
  const allDisciplines = useMemo(
    () => withLocalOptions(disciplineOptions, localOptions.discipline),
    [disciplineOptions, localOptions.discipline],
  );
  const allDivisions = useMemo(
    () => withLocalOptions(divisionOptions, localOptions.division),
    [divisionOptions, localOptions.division],
  );

  const halter = disciplineOptions.find(
    (d) => /halter/i.test(d.name) && !/performance/i.test(d.name),
  );
  const startDiscipline = (preset === 'grand' && halter ? halter : disciplineOptions[0])?.key ?? '';
  const startDivision = divisionOptions[0]?.key ?? '';

  const [disciplineKey, setDisciplineKey] = useState(startDiscipline);
  const [divisionKey, setDivisionKey] = useState(startDivision);
  const [date, setDate] = useState(defaultDate);
  // Untouched, the name follows the pickers; once somebody types, it is theirs.
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [mustQualify, setMustQualify] = useState(preset === 'grand');
  const [qualifyTouched, setQualifyTouched] = useState(preset === 'grand');
  const [placeAfter, setPlaceAfter] = useState<string>('auto');
  const [saving, setSaving] = useState(false);
  // Which picker is being added to from inside the form, if either. Picking
  // "Add a new…" never becomes the select's value — the value stays the last
  // real option, so the control snaps back to it and the new name is typed in a
  // box beside it instead. A select left reading "Add a new…" is a form that
  // looks like it is about to submit something that does not exist.
  const [addingAxis, setAddingAxis] = useState<Axis | null>(null);
  const [axisDraft, setAxisDraft] = useState('');

  // A discipline or division this form has selected can go while it is open —
  // the × on a picker heading, or another tab. Fall back to the first that is
  // still there rather than leaving a select showing nothing.
  useEffect(() => {
    if (allDisciplines.length > 0 && !allDisciplines.some((d) => d.key === disciplineKey)) {
      setDisciplineKey(allDisciplines[0].key);
    }
  }, [allDisciplines, disciplineKey]);
  useEffect(() => {
    if (allDivisions.length > 0 && !allDivisions.some((d) => d.key === divisionKey)) {
      setDivisionKey(allDivisions[0].key);
    }
  }, [allDivisions, divisionKey]);

  function commitAxisDraft() {
    const name = axisDraft.trim();
    if (!addingAxis || !name) return;
    const key = normalizeName(name);
    const list = addingAxis === 'discipline' ? allDisciplines : allDivisions;
    if (!list.some((o) => o.key === key)) {
      const option: AxisOption = { key, name, id: null, classCount: 0, inLibrary: false };
      setLocalOptions((prev) => ({ ...prev, [addingAxis]: [...prev[addingAxis], option] }));
    }
    if (addingAxis === 'discipline') setDisciplineKey(key);
    else setDivisionKey(key);
    setAddingAxis(null);
    setAxisDraft('');
  }

  const disc = allDisciplines.find((d) => d.key === disciplineKey);
  const div = allDivisions.find((d) => d.key === divisionKey);
  const suggestedName = disc && div
    ? `${preset === 'grand' ? 'Grand & Reserve ' : ''}${div.name} ${disc.name}`
    : '';
  const effectiveName = nameTouched ? name : suggestedName;
  const effectiveQualify = qualifyTouched ? mustQualify : looksLikeQualifyingClass(effectiveName);

  const dayClasses = useMemo(
    () => scheduleOrder(classes).filter((c) => c.class_date === date),
    [classes, date],
  );
  // "auto" is the default for the Grand & Reserve preset: straight after the
  // last class that day in the same cell, which is where the classes it calls
  // back from run. Otherwise, and when there is no such class, the end of the day.
  const autoAfter = useMemo(() => {
    // A cell this show has never used has no id to match on, and no classes in
    // it either, so there is nothing to run after.
    if (preset !== 'grand' || !disc?.id || !div?.id) return null;
    const sameCell = dayClasses.filter(
      (c) => c.discipline_id === disc.id && c.division_id === div.id,
    );
    return sameCell.length > 0 ? sameCell[sameCell.length - 1] : null;
  }, [preset, dayClasses, disc?.id, div?.id]);
  const afterId = placeAfter === 'auto' ? autoAfter?.id ?? 'end' : placeAfter;

  /**
   * The class already on that day under that name, if there is one.
   *
   * Pressing the Grand & Reserve shortcut twice produces the same suggested
   * name twice, and so does typing a name the grid already generated — and
   * two classes sharing a name on one day is a schedule the show bill cannot
   * print and the gate cannot call. Keyed on the name rather than on the
   * discipline-and-division cell, because "Grand & Reserve Amateur Mares" and
   * "Grand & Reserve Amateur Geldings" are legitimately the same cell on the
   * same day. `POST /shows/{id}/classes` refuses it either way; this is so
   * nobody fills the form in first.
   */
  const clash = useMemo(() => {
    const wanted = effectiveName.trim().toLowerCase();
    if (!wanted) return null;
    return (
      classes.find(
        (c) => c.class_date === date && c.class_name.trim().toLowerCase() === wanted,
      ) ?? null
    );
  }, [classes, date, effectiveName]);

  async function submit() {
    const className = effectiveName.trim();
    if (!className || !disc || !div || clash) return;
    setError(null);
    setSaving(true);
    try {
      // The picked discipline or division may be a standard-library name, or
      // one typed into this form, that the show has no row for yet. Create them
      // here rather than when they were picked, so a form somebody closed
      // leaves nothing behind.
      const pair = await resolveAxisPair(disc, div);
      if (!pair) return;

      const res = await fetch(`/api/shows/${showId}/classes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discipline_id: pair.disciplineId,
          division_id: pair.divisionId,
          class_name: className,
          class_date: date,
          status: 'OPEN',
          entered_by_qualification: effectiveQualify,
        }),
      });
      const created = await res.json().catch(() => null);
      if (!res.ok || !created?.id) {
        setError(created?.detail || `Failed to create "${className}".`);
        return;
      }

      const rows = await refreshClasses();
      let where = 'at the end of the day';
      if (rows && afterId !== 'end') {
        const ordered = scheduleOrder(rows);
        const mine = ordered.find((c) => c.id === created.id);
        const rest = ordered.filter((c) => c.id !== created.id);
        const at = rest.findIndex((c) => c.id === afterId);
        if (mine && at >= 0 && rest[at].class_date === date) {
          rest.splice(at + 1, 0, mine);
          await saveOrder(rest);
          where = `after #${rest[at].class_number}`;
        }
      }

      onCreated(created.id, `Added “${className}” on ${date}, ${where}.`);
    } finally {
      setSaving(false);
    }
  }

  const fieldStyle = { borderColor: COLORS.border, backgroundColor: 'var(--surface)', color: COLORS.text };

  return (
    <div
      className="rounded border p-3 space-y-3"
      style={{ borderColor: COLORS.border, backgroundColor: 'var(--surface)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: COLORS.text }}>
            {preset === 'grand' ? 'Add a Grand & Reserve Class' : 'Add Class'}
          </h3>
          <p className="text-xs mt-0.5" style={{ color: COLORS.muted }}>
            {preset === 'grand'
              ? 'The top placings from the classes before it are called back, so entry is by qualifying. Name it the way your show bill does — "Grand & Reserve Amateur Mares".'
              : 'Enter your own class details. It is filed under the discipline and division you pick.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs hover:underline shrink-0"
          style={{ color: COLORS.muted }}
        >
          Close
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {(['discipline', 'division'] as Axis[]).map((axis) => {
          const copy = AXIS_COPY[axis];
          // Alphabetical, the same order the picker's columns and rows run in:
          // these lists carry a show type's whole standard library, and a
          // thirty-name select is read by hunting for a name.
          const rows = axis === 'discipline' ? allDisciplines : allDivisions;
          const value = axis === 'discipline' ? disciplineKey : divisionKey;
          const set = axis === 'discipline' ? setDisciplineKey : setDivisionKey;
          return (
            <label key={axis} className="block text-xs" style={{ color: COLORS.muted }}>
              {copy.singular}
              <select
                value={value}
                onChange={(e) => {
                  if (e.target.value === ADD_AXIS_OPTION) {
                    setAddingAxis(axis);
                    setAxisDraft('');
                    return;
                  }
                  set(e.target.value);
                }}
                className="mt-1 w-full border rounded px-2 py-1.5 text-sm"
                style={fieldStyle}
              >
                {rows.map((d) => (
                  <option key={d.key} value={d.key}>{d.name}</option>
                ))}
                <option value={ADD_AXIS_OPTION}>+ Add a new {copy.noun}…</option>
              </select>
              {addingAxis === axis && (
                <span className="mt-1 flex items-center gap-1.5">
                  <input
                    type="text"
                    autoFocus
                    value={axisDraft}
                    onChange={(e) => setAxisDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitAxisDraft();
                      }
                      if (e.key === 'Escape') setAddingAxis(null);
                    }}
                    placeholder={`New ${copy.noun} name…`}
                    aria-label={`New ${copy.noun} name`}
                    className="flex-1 min-w-0 border rounded px-2 py-1.5 text-sm"
                    style={fieldStyle}
                  />
                  <button
                    type="button"
                    onClick={commitAxisDraft}
                    disabled={!axisDraft.trim()}
                    className="text-xs rounded px-2 py-1.5 shrink-0 disabled:opacity-50"
                    style={{ backgroundColor: COLORS.warn, color: 'var(--surface)' }}
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddingAxis(null)}
                    className="text-xs hover:underline shrink-0"
                    style={{ color: COLORS.muted }}
                  >
                    Cancel
                  </button>
                </span>
              )}
            </label>
          );
        })}
        <label className="block text-xs" style={{ color: COLORS.muted }}>
          Show day
          <select
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setPlaceAfter('auto');
            }}
            className="mt-1 w-full border rounded px-2 py-1.5 text-sm"
            style={fieldStyle}
          >
            {dates.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="block text-xs" style={{ color: COLORS.muted }}>
        Class name
        <input
          type="text"
          value={effectiveName}
          onChange={(e) => {
            setName(e.target.value);
            setNameTouched(true);
          }}
          maxLength={200}
          className="mt-1 w-full border rounded px-2 py-1.5 text-sm"
          style={fieldStyle}
        />
      </label>

      <label className="block text-xs" style={{ color: COLORS.muted }}>
        Runs
        <select
          value={placeAfter === 'auto' ? afterId : placeAfter}
          onChange={(e) => setPlaceAfter(e.target.value)}
          className="mt-1 w-full border rounded px-2 py-1.5 text-sm"
          style={fieldStyle}
        >
          <option value="end">At the end of {date}</option>
          {dayClasses.map((c) => (
            <option key={c.id} value={c.id}>
              After #{c.class_number} {c.class_name}
            </option>
          ))}
        </select>
      </label>

      <label
        className="flex items-start gap-2 text-sm cursor-pointer"
        style={{ color: COLORS.text }}
      >
        <input
          type="checkbox"
          className="mt-0.5"
          checked={effectiveQualify}
          onChange={(e) => {
            setMustQualify(e.target.checked);
            setQualifyTouched(true);
          }}
        />
        <span>
          Must qualify
          <span className="block text-xs" style={{ color: COLORS.muted }}>
            Exhibitors can&rsquo;t enter it themselves; the desk enters the horses
            called back. Leave it unticked for open entry.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={submit}
          disabled={saving || !effectiveName.trim() || clash !== null}
          title={
            clash
              ? `${date} already runs a class called “${clash.class_name}” (#${clash.class_number}). Change the name or the day.`
              : !effectiveName.trim()
                ? 'Give the class a name'
                : undefined
          }
          className="text-sm rounded px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: COLORS.warn, color: 'var(--surface)' }}
        >
          {saving ? 'Adding…' : 'Add class'}
        </button>
        {clash && (
          <span className="text-xs" role="alert" style={{ color: 'var(--error-strong)' }}>
            Already on {date} as #{clash.class_number} {clash.class_name}. Change the
            name or the day.
          </span>
        )}
      </div>
    </div>
  );
}
