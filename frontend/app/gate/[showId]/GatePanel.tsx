'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { patternFileHref } from '@/lib/patterns';
import { errorMessage } from '@/lib/api-error';

type GateClassStatus = 'pending' | 'ready' | 'in_progress' | 'done';

/** One class as `GET /shows/{id}/gate/classes` serves it: the public class
 *  payload, with `ready` derived by the backend and the check-in counts. */
export type GateClassRow = {
  id: string;
  class_number: string;
  class_name: string;
  class_date: string;
  status: string;
  ring_id: string | null;
  /** Ready is worked out from the riders (`backend/gate_rules.py`), never stored. */
  gate_status: GateClassStatus;
  /** Riders not scratched. */
  entry_count: number;
  checked_in_count: number;
  no_show_count: number;
  score_type?: string;
  /** When the judge posted this class’s pattern (migration 120). */
  pattern_posted_at?: string | null;
  /** The pattern file the office put on file for this class (migration 146) —
   *  what the steward checks the board by the gate against. */
  pattern_id?: string | null;
  pattern_name?: string | null;
  /** The association’s class-procedure note for this show’s zone, where it has
   *  one. APHA Zones 12-14 run equitation and horsemanship individually from
   *  the gate with no rail work — a different class than the same class in
   *  Zone 3, and the steward needs it before the class starts. Computed by the
   *  backend so the wording lives in one place. */
  procedure_note?: string | null;
};

type GateEntry = {
  id: string;
  back_number: number | null;
  exhibitor_name: string;
  horse_name: string | null;
  is_disqualified: boolean;
  gate_order: number | null;
  gate_checked_in: boolean;
  /** Called for and never came (migration 162). Not a scratch. */
  gate_no_show: boolean;
};

type RiderState = 'checked_in' | 'no_show' | 'waiting';

type Counts = { entries: number; checkedIn: number; noShow: number };

/** Where a class stands in its ring's running order. */
type Position = 'Done' | 'In the ring' | 'On deck' | 'Waiting';

const POSITION_COLORS: Record<Position, { bg: string; fg: string }> = {
  Done: { bg: 'var(--border-subtle)', fg: 'var(--muted)' },
  'In the ring': { bg: 'var(--success-bg)', fg: 'var(--success-strong)' },
  'On deck': { bg: 'var(--warning-border)', fg: 'var(--warning-strong)' },
  Waiting: { bg: 'var(--bg-subtle)', fg: 'var(--text-deep)' },
};

/** Changes made elsewhere — a rider the office adds or scratches, a second
 *  steward's check-ins, a class moved in the schedule — reach this screen on
 *  this interval. */
const POLL_MS = 10_000;

const NETWORK_ERROR = 'Could not reach the server, so that was not saved. Check the connection and try again.';

function localToday(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
}

/** A posting time, read as a clock time — the steward cares about "when", not the date. */
function formatPosted(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function started(c: GateClassRow): boolean {
  return c.gate_status === 'in_progress' || c.gate_status === 'done';
}

function ringKey(c: GateClassRow): string {
  return c.ring_id ?? 'no-ring';
}

function numbers(classes: GateClassRow[]): string {
  return classes.map(c => `#${c.class_number}`).join(' & ');
}

function riderState(e: GateEntry): RiderState {
  if (e.gate_no_show) return 'no_show';
  return e.gate_checked_in ? 'checked_in' : 'waiting';
}

function countEntries(entries: GateEntry[]): Counts {
  return {
    entries: entries.length,
    checkedIn: entries.filter(e => e.gate_checked_in && !e.gate_no_show).length,
    noShow: entries.filter(e => e.gate_no_show).length,
  };
}

async function readBody(res: Response): Promise<any> {
  return res.json().catch(() => null);
}

export default function GatePanel({ showId, classes: initialClasses }: { showId: string; classes: GateClassRow[] }) {
  const [classes, setClasses] = useState<GateClassRow[]>(initialClasses);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [entries, setEntries] = useState<GateEntry[]>([]);
  /** The class `entries` belongs to — so a list loaded for one class is never
   *  read as another's while the next one loads. */
  const [entriesFor, setEntriesFor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingRiders, setPendingRiders] = useState<Set<string>>(new Set());
  const [savingOrder, setSavingOrder] = useState(false);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [confirmingSkip, setConfirmingSkip] = useState(false);

  // The poll must never paint over a tap: a refresh that set off before the
  // tap and lands after it would put back what the tap just changed. Every
  // write bumps `generation`, and a refresh that sees it moved is dropped.
  const inFlight = useRef(0);
  const generation = useRef(0);
  const dragging = useRef(false);
  const selectedRef = useRef<string | null>(null);
  // Declared before the effect that loads a class's riders, so the loader
  // reads the class it was asked for.
  useEffect(() => {
    selectedRef.current = selectedClassId;
  }, [selectedClassId]);

  // The gate screen is scoped to a single show day: today when the show is
  // running, otherwise the first day that still has unfinished classes (so
  // the screen stays usable when previewing before/after a show day).
  const dates = Array.from(new Set(classes.map(c => c.class_date))).sort();
  const today = localToday();
  const activeDate = dates.includes(today)
    ? today
    : dates.find(d => classes.some(c => c.class_date === d && c.gate_status !== 'done')) ??
      dates[dates.length - 1] ??
      null;
  const dayClasses = classes.filter(c => c.class_date === activeDate);

  // A lane is one ring's classes for the day, in running order — the order
  // the backend hands them over in, which is the order the gate enforces.
  // Classes run in order: each lane's first class not yet started is on deck,
  // and it is the only one that can start.
  const lanes = new Map<string, GateClassRow[]>();
  for (const c of dayClasses) {
    const lane = lanes.get(ringKey(c));
    if (lane) lane.push(c);
    else lanes.set(ringKey(c), [c]);
  }
  const onDeckIds = new Set<string>();
  for (const lane of lanes.values()) {
    const deck = lane.find(c => !started(c));
    if (deck) onDeckIds.add(deck.id);
  }
  const firstOnDeck = dayClasses.find(c => onDeckIds.has(c.id)) ?? null;

  function position(c: GateClassRow): Position {
    if (c.gate_status === 'done') return 'Done';
    if (c.gate_status === 'in_progress') return 'In the ring';
    return onDeckIds.has(c.id) ? 'On deck' : 'Waiting';
  }

  /** The selected class's counts come off its loaded riders, so a tap shows at
   *  once; every other class's come off the last refresh. */
  function countsFor(c: GateClassRow): Counts {
    if (c.id === entriesFor && c.id === selectedClassId) return countEntries(entries);
    return { entries: c.entry_count, checkedIn: c.checked_in_count, noShow: c.no_show_count };
  }

  function beginWrite() {
    inFlight.current += 1;
    generation.current += 1;
  }

  function endWrite() {
    inFlight.current -= 1;
    generation.current += 1;
    // Once the last write lands, read the whole picture back: two taps in
    // quick succession each answer with the class status as of their own
    // commit, and the later answer is not always the one that arrives last.
    if (inFlight.current === 0) void refresh();
  }

  const refresh = useCallback(async () => {
    if (inFlight.current > 0 || dragging.current) return;
    const gen = generation.current;
    const classId = selectedRef.current;
    try {
      const [classRes, entryRes] = await Promise.all([
        fetch(`/api/shows/${showId}/gate/classes`, { cache: 'no-store' }),
        classId
          ? fetch(`/api/shows/${showId}/gate/classes/${classId}/entries`, { cache: 'no-store' })
          : Promise.resolve(null),
      ]);
      const classJson = await readBody(classRes);
      const entryJson = entryRes ? await readBody(entryRes) : null;
      if (gen !== generation.current || inFlight.current > 0 || dragging.current) return;
      if (!classRes.ok || !Array.isArray(classJson)) {
        setOffline(true);
        return;
      }
      setOffline(false);
      setClasses(classJson);
      if (classId && classId === selectedRef.current && entryRes?.ok && Array.isArray(entryJson)) {
        setEntries(entryJson);
        setEntriesFor(classId);
      }
    } catch {
      setOffline(true);
    }
  }, [showId]);

  // Poll while the screen is in front of somebody: stop while the tab is
  // hidden (a phone in a pocket all day would otherwise poll its battery
  // flat) and refresh the moment it is picked up again.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(() => void refresh(), POLL_MS);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refresh]);

  // Default to the day's first class on deck; the steward can still pick any
  // class from the list — to check riders in ahead, or to look back. A class
  // the office deleted drops the selection.
  useEffect(() => {
    if (selectedClassId && !classes.some(c => c.id === selectedClassId)) {
      setSelectedClassId(null);
    } else if (!selectedClassId && firstOnDeck) {
      setSelectedClassId(firstOnDeck.id);
    }
  }, [selectedClassId, firstOnDeck, classes]);

  const loadEntries = useCallback(async (classId: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/shows/${showId}/gate/classes/${classId}/entries`, { cache: 'no-store' });
      const json = await readBody(res);
      if (classId !== selectedRef.current) return;
      if (!res.ok || !Array.isArray(json)) {
        setError(errorMessage(json, 'Failed to load the riders for this class.'));
        setEntries([]);
        setEntriesFor(null);
        return;
      }
      setEntries(json);
      setEntriesFor(classId);
    } catch {
      if (classId === selectedRef.current) setError('Could not reach the server to load this class.');
    } finally {
      setLoading(false);
    }
  }, [showId]);

  useEffect(() => {
    if (selectedClassId) void loadEntries(selectedClassId);
    setConfirmingReset(false);
    setConfirmingSkip(false);
  }, [selectedClassId, loadEntries]);

  // Drag-and-drop reorder with optimistic update and auto-save on drop,
  // matching the class wizard's reorder behavior. On failure the list is
  // refreshed from the server so it never shows an unsaved order.
  async function handleDragEnd(result: DropResult) {
    dragging.current = false;
    const { source, destination } = result;
    if (!destination || destination.index === source.index) return;
    if (!selectedClassId) return;

    const reordered = [...entries];
    const [moved] = reordered.splice(source.index, 1);
    reordered.splice(destination.index, 0, moved);
    setEntries(reordered.map((e, i) => ({ ...e, gate_order: i + 1 })));

    setError('');
    setSavingOrder(true);
    beginWrite();
    try {
      const res = await fetch(`/api/shows/${showId}/gate/classes/${selectedClassId}/order`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry_ids: reordered.map(e => e.id) }),
      });
      const json = await readBody(res);
      if (!res.ok || !Array.isArray(json)) {
        setError(errorMessage(json, 'Failed to save the new order.'));
        await loadEntries(selectedClassId);
        return;
      }
      setEntries(json);
    } catch {
      setError(NETWORK_ERROR);
      await loadEntries(selectedClassId);
    } finally {
      setSavingOrder(false);
      endWrite();
    }
  }

  // Each rider saves on their own, so the steward can work down a line of
  // riders without waiting for each tap to come back.
  async function setRider(entryId: string, state: RiderState) {
    const classId = selectedClassId;
    if (!classId) return;
    setPendingRiders(prev => new Set(prev).add(entryId));
    setError('');
    beginWrite();
    try {
      const res = await fetch(
        `/api/shows/${showId}/gate/classes/${classId}/entries/${entryId}/check-in`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checked_in: state === 'checked_in', no_show: state === 'no_show' }),
        },
      );
      const json = await readBody(res);
      if (!res.ok || !json?.entry) {
        setError(errorMessage(json, 'Failed to update this rider.'));
        return;
      }
      if (classId === selectedRef.current) {
        setEntries(prev => prev.map(e => (e.id === entryId ? json.entry : e)));
      }
      setClasses(prev =>
        prev.map(c => (c.id === classId ? { ...c, gate_status: json.class_gate_status } : c)),
      );
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setPendingRiders(prev => {
        const next = new Set(prev);
        next.delete(entryId);
        return next;
      });
      endWrite();
    }
  }

  /** Move a class through the gate. The backend answers with the whole class
   *  list, since a start can finish the classes ahead of it. */
  async function setClassStatus(
    classId: string,
    gateStatus: GateClassStatus,
    concurrent = false,
  ): Promise<GateClassRow[] | null> {
    setBusy(true);
    setError('');
    beginWrite();
    try {
      const res = await fetch(`/api/shows/${showId}/gate/classes/${classId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gate_status: gateStatus, concurrent }),
      });
      const json = await readBody(res);
      if (!res.ok || !Array.isArray(json)) {
        setError(errorMessage(json, 'Failed to update the class.'));
        return null;
      }
      setClasses(json);
      return json;
    } catch {
      setError(NETWORK_ERROR);
      return null;
    } finally {
      setBusy(false);
      endWrite();
    }
  }

  /** After a class starts or finishes, move on to what is now on deck in the
   *  same ring — the steward's next job. Stay put when nothing is left in it. */
  function moveToNextInRing(rows: GateClassRow[], from: GateClassRow) {
    const next = rows.find(
      c => c.class_date === from.class_date && ringKey(c) === ringKey(from) && !started(c),
    );
    if (next) setSelectedClassId(next.id);
  }

  // Starting the class finishes every class in the ring ahead of it; running
  // it alongside them (`concurrent`) leaves them going, and the next ordinary
  // start finishes the whole group. Only the class on deck can start.
  async function startClass(concurrent: boolean) {
    if (!selectedClass) return;
    const rows = await setClassStatus(selectedClass.id, 'in_progress', concurrent);
    if (rows) moveToNextInRing(rows, selectedClass);
  }

  async function finishClass() {
    if (!selectedClass) return;
    const rows = await setClassStatus(selectedClass.id, 'done');
    if (rows) {
      setConfirmingSkip(false);
      moveToNextInRing(rows, selectedClass);
    }
  }

  // Every pattern class in the rule book requires the judge to post the pattern
  // at least an hour before it runs. The app cannot check the hour — classes
  // carry a date and no start time — so this records whether it went up and
  // when, which is the half that is answerable.
  async function setPatternPosted(posted: boolean) {
    if (!selectedClassId) return;
    setBusy(true);
    setError('');
    beginWrite();
    try {
      const res = await fetch(`/api/shows/${showId}/gate/classes/${selectedClassId}/pattern`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ posted }),
      });
      const json = await readBody(res);
      if (!res.ok) {
        setError(errorMessage(json, 'Failed to record the pattern.'));
        return;
      }
      setClasses(prev =>
        prev.map(c =>
          c.id === selectedClassId ? { ...c, pattern_posted_at: json?.pattern_posted_at ?? null } : c,
        ),
      );
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setBusy(false);
      endWrite();
    }
  }

  // SC-185.I — "a working order may be established by drawing for that order."
  // The steward could always drag the order into place; there was no way to
  // produce one the way the rules describe. Re-drawable on purpose: the same
  // rule lets show management alter the order at its discretion, and a draw
  // that could not be redone after a scratch would be worse than none.
  async function drawOrder() {
    if (!selectedClassId) return;
    setBusy(true);
    setError('');
    beginWrite();
    try {
      const res = await fetch(`/api/shows/${showId}/gate/classes/${selectedClassId}/draw`, {
        method: 'POST',
      });
      const json = await readBody(res);
      if (!res.ok || !Array.isArray(json)) {
        setError(errorMessage(json, 'Failed to draw the order of go.'));
        return;
      }
      setEntries(json);
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setBusy(false);
      endWrite();
    }
  }

  // Clears every check-in and no-show on a class not yet started.
  async function resetClass() {
    if (!selectedClassId) return;
    setBusy(true);
    setError('');
    beginWrite();
    try {
      const res = await fetch(`/api/shows/${showId}/gate/classes/${selectedClassId}/reset`, {
        method: 'POST',
      });
      const json = await readBody(res);
      if (!res.ok || !Array.isArray(json)) {
        setError(errorMessage(json, 'Failed to clear the check-ins.'));
        return;
      }
      setEntries(json);
      setClasses(prev =>
        prev.map(c => (c.id === selectedClassId ? { ...c, gate_status: 'pending' } : c)),
      );
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setBusy(false);
      setConfirmingReset(false);
      endWrite();
    }
  }

  const selectedClass = classes.find(c => c.id === selectedClassId) || null;
  const lane = selectedClass ? lanes.get(ringKey(selectedClass)) ?? [] : [];
  const laneIndex = selectedClass ? lane.findIndex(c => c.id === selectedClass.id) : -1;
  const ahead = laneIndex >= 0 ? lane.slice(0, laneIndex) : [];
  const behind = laneIndex >= 0 ? lane.slice(laneIndex + 1) : [];
  const inRingAhead = ahead.filter(c => c.gate_status === 'in_progress');
  const runningWith = selectedClass?.gate_status === 'in_progress'
    ? lane.filter(c => c.id !== selectedClass.id && c.gate_status === 'in_progress')
    : [];
  const deckInLane = lane.find(c => onDeckIds.has(c.id)) ?? null;
  const upNextInLane = behind.find(c => !started(c)) ?? null;

  const counts = selectedClass ? countsFor(selectedClass) : { entries: 0, checkedIn: 0, noShow: 0 };
  const stillToCome = counts.entries - counts.checkedIn - counts.noShow;
  const isStarted = selectedClass ? started(selectedClass) : false;
  const isOnDeck = selectedClass ? onDeckIds.has(selectedClass.id) : false;
  const isReady = selectedClass?.gate_status === 'ready';
  const entriesLoaded = selectedClass != null && entriesFor === selectedClass.id && !loading;
  const nothingToRun = entriesLoaded && counts.checkedIn === 0 && stillToCome === 0;
  const ridersSaving = pendingRiders.size > 0;
  const canUndoStart = selectedClass?.gate_status === 'in_progress' && !behind.some(started);
  const canReopen = selectedClass?.gate_status === 'done' && !behind.some(c => c.gate_status === 'done');

  return (
    <div className="space-y-5">
      {offline && (
        <p
          className="text-xs rounded px-2 py-1.5"
          style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning)', border: '1px solid var(--warning-border)' }}
        >
          Can&apos;t reach the server. Retrying, but what you see may be out of date.
        </p>
      )}

      {/* ── Order of Go ─────────────────────────────────────────────────── */}
      <section className="p-4 rounded-lg border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
        {!selectedClass ? (
          <div>
            <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--foreground)' }}>Order of go</h2>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              {dayClasses.length === 0
                ? 'No classes scheduled for this day.'
                : 'Every class today has started or finished. Pick a class below to review it.'}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                Order of go — #{selectedClass.class_number} {selectedClass.class_name}
              </h2>
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: POSITION_COLORS[position(selectedClass)].bg,
                  color: POSITION_COLORS[position(selectedClass)].fg,
                }}
              >
                {position(selectedClass)}
              </span>
              {isReady && (
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent)' }}>
                  Ready
                </span>
              )}
              {entries.length > 1 && (
                <>
                  <span className="text-xs" style={{ color: 'var(--border)' }}>· drag to reorder</span>
                  <button
                    type="button"
                    onClick={drawOrder}
                    disabled={busy}
                    title="Draw the order of go at random (APHA SC-185.I). You can still drag afterwards."
                    className="text-xs underline disabled:opacity-50"
                    style={{ color: 'var(--accent)' }}
                  >
                    · draw order
                  </button>
                </>
              )}
              {savingOrder && (
                <span className="text-xs" style={{ color: 'var(--success-strong)' }}>· saving…</span>
              )}
            </div>
            {(selectedClass.score_type === 'pattern' || selectedClass.pattern_id) && (
              <div
                className="text-xs mb-3 rounded px-2 py-1.5 flex items-center gap-2 flex-wrap"
                style={{ backgroundColor: selectedClass.pattern_posted_at ? 'var(--success-bg)' : 'var(--background)', border: `1px solid ${selectedClass.pattern_posted_at ? 'var(--success-border)' : 'var(--border-subtle)'}` }}
              >
                <span style={{ color: selectedClass.pattern_posted_at ? 'var(--success-strong)' : 'var(--muted)' }}>
                  {selectedClass.pattern_posted_at
                    ? `✓ Pattern posted ${formatPosted(selectedClass.pattern_posted_at)}`
                    : 'Pattern not yet posted — the rules require it an hour before the class.'}
                </span>
                <button
                  type="button"
                  onClick={() => setPatternPosted(!selectedClass.pattern_posted_at)}
                  disabled={busy}
                  className="underline disabled:opacity-50"
                  style={{ color: 'var(--accent)' }}
                >
                  {selectedClass.pattern_posted_at ? 'Undo' : 'Mark posted'}
                </button>
                {selectedClass.pattern_id && (
                  <a
                    href={patternFileHref(showId, selectedClass.pattern_id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                    style={{ color: 'var(--accent)' }}
                    title="The file exhibitors see for this class. The one posted at the gate is the official copy."
                  >
                    Open {selectedClass.pattern_name ?? 'pattern'} ↗
                  </a>
                )}
              </div>
            )}
            {selectedClass.procedure_note && (
              <p
                className="text-xs mb-3 rounded px-2 py-1.5"
                style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning)', border: '1px solid var(--warning-border)' }}
              >
                ⚠ {selectedClass.procedure_note}
              </p>
            )}
            <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
              {counts.entries === 0
                ? 'No entries in this class.'
                : `${counts.checkedIn} of ${counts.entries} checked in` +
                  (counts.noShow > 0 ? ` · ${counts.noShow} no-show` : '') +
                  (!isStarted && stillToCome > 0 ? ` · ${stillToCome} still to come` : '')}
              {upNextInLane && ` · Up next: #${upNextInLane.class_number} ${upNextInLane.class_name}`}
            </p>

            {/* Not started, nobody to ride it: only skipping clears it, and
                only on deck — skipping marks it completed, which would shut a
                late entry out of a class further down the day. */}
            {!isStarted && nothingToRun && (
              <div
                className="rounded border p-3 mb-3 space-y-2"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--warning-bg)' }}
              >
                <p className="text-sm" style={{ color: 'var(--warning-strong)' }}>
                  {counts.entries === 0 ? 'This class has no entries.' : 'Every rider in this class is a no-show.'}
                  {isOnDeck
                    ? ' Skip it to move on to the next class.'
                    : ' It can be skipped once it is on deck.'}
                </p>
                {isOnDeck && (!confirmingSkip ? (
                  <button
                    onClick={() => setConfirmingSkip(true)}
                    disabled={busy}
                    className="text-sm px-3 py-1 rounded text-white disabled:opacity-50"
                    style={{ backgroundColor: 'var(--warning-strong)' }}
                  >
                    Skip class…
                  </button>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs" style={{ color: 'var(--warning-strong)' }}>
                      Mark #{selectedClass.class_number} done without running it?
                    </span>
                    <button
                      onClick={finishClass}
                      disabled={busy}
                      className="text-xs px-2 py-0.5 rounded text-white disabled:opacity-50"
                      style={{ backgroundColor: 'var(--warning-strong)' }}
                    >
                      {busy ? 'Skipping…' : 'Yes, skip it'}
                    </button>
                    <button
                      onClick={() => setConfirmingSkip(false)}
                      disabled={busy}
                      className="text-xs px-2 py-0.5 rounded border disabled:opacity-50"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-deep)' }}
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* On deck and ready: the only class in the ring that can start. */}
            {!isStarted && isOnDeck && isReady && (
              <div
                className="rounded border p-3 mb-3 space-y-2"
                style={{ borderColor: 'var(--accent-border)', backgroundColor: 'var(--accent-bg)' }}
              >
                <p className="text-sm" style={{ color: 'var(--accent)' }}>
                  Every rider is checked in or a no-show. Start the class when the first rider enters the ring.
                </p>
                {inRingAhead.length === 0 ? (
                  <button
                    onClick={() => startClass(false)}
                    disabled={busy || ridersSaving}
                    title={ridersSaving ? 'Waiting for a check-in to save' : undefined}
                    className="text-sm px-3 py-1.5 rounded text-white disabled:opacity-50"
                    style={{ backgroundColor: 'var(--accent)' }}
                  >
                    {busy ? 'Starting…' : 'First rider in the ring — start class'}
                  </button>
                ) : (
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => startClass(false)}
                      disabled={busy || ridersSaving}
                      title={
                        ridersSaving
                          ? 'Waiting for a check-in to save'
                          : `Marks ${numbers(inRingAhead)} done and starts this class`
                      }
                      className="text-sm px-3 py-1.5 rounded text-white disabled:opacity-50"
                      style={{ backgroundColor: 'var(--accent)' }}
                    >
                      {busy ? 'Starting…' : `Start — closes ${numbers(inRingAhead)}`}
                    </button>
                    <button
                      onClick={() => startClass(true)}
                      disabled={busy || ridersSaving}
                      title={
                        ridersSaving
                          ? 'Waiting for a check-in to save'
                          : `Runs this class at the same time as ${numbers(inRingAhead)}. The next class's start closes them all.`
                      }
                      className="text-sm px-3 py-1.5 rounded border disabled:opacity-50"
                      style={{ borderColor: 'var(--accent)', color: 'var(--accent)', backgroundColor: 'var(--surface)' }}
                    >
                      Run with {numbers(inRingAhead)}
                    </button>
                  </div>
                )}
              </div>
            )}

            {!isStarted && isOnDeck && !isReady && entriesLoaded && !nothingToRun && (
              <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>
                The class can start once every rider is checked in or marked a no-show.
              </p>
            )}

            {!isStarted && !isOnDeck && isReady && deckInLane && (
              <p className="text-sm mb-3" style={{ color: 'var(--accent)' }}>
                Ready. Classes run in order, so it can start after #{deckInLane.class_number} {deckInLane.class_name}.
              </p>
            )}

            {selectedClass.gate_status === 'in_progress' && (
              <div
                className="rounded border p-3 mb-3 flex items-center justify-between gap-2 flex-wrap"
                style={{ borderColor: 'var(--success-border)', backgroundColor: 'var(--success-bg)' }}
              >
                <p className="text-sm" style={{ color: 'var(--success-strong)' }}>
                  In the ring{runningWith.length > 0 ? `, running with ${numbers(runningWith)}` : ''}.
                  {upNextInLane ? ` Starting #${upNextInLane.class_number} closes it.` : ''}
                </p>
                <span className="flex gap-2 shrink-0">
                  {canUndoStart && (
                    <button
                      onClick={() => setClassStatus(selectedClass.id, 'pending')}
                      disabled={busy}
                      title="Started by mistake? Put the class back to not started"
                      className="text-xs px-3 py-1 rounded border disabled:opacity-50"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-deep)', backgroundColor: 'var(--surface)' }}
                    >
                      Undo start
                    </button>
                  )}
                  <button
                    onClick={finishClass}
                    disabled={busy}
                    title="For the last class in the ring, or a break — otherwise starting the next class closes this one"
                    className="text-xs px-3 py-1 rounded border disabled:opacity-50"
                    style={{ borderColor: 'var(--success-border)', color: 'var(--success-strong)', backgroundColor: 'var(--surface)' }}
                  >
                    Mark class done
                  </button>
                </span>
              </div>
            )}

            {selectedClass.gate_status === 'done' && (
              <div
                className="rounded border p-3 mb-3 flex items-center justify-between gap-2 flex-wrap"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}
              >
                <p className="text-sm" style={{ color: 'var(--text-deep)' }}>
                  This class is done at the gate.
                </p>
                {canReopen && (
                  <button
                    onClick={() => setClassStatus(selectedClass.id, 'in_progress')}
                    disabled={busy}
                    title="Closed by mistake? Put the class back in the ring"
                    className="text-xs px-3 py-1 rounded border disabled:opacity-50"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-deep)', backgroundColor: 'var(--surface)' }}
                  >
                    Reopen class
                  </button>
                )}
              </div>
            )}

            {error && <p className="text-sm mb-2" style={{ color: 'var(--error-strong)' }}>{error}</p>}
            {loading && entriesFor !== selectedClass.id ? (
              <p className="text-sm" style={{ color: 'var(--muted)' }}>Loading riders…</p>
            ) : entriesFor === selectedClass.id && entries.length > 0 && (
              <DragDropContext
                onDragStart={() => {
                  dragging.current = true;
                }}
                onDragEnd={handleDragEnd}
              >
                <Droppable droppableId="gate-order">
                  {(dropProvided) => (
                    <ul
                      ref={dropProvided.innerRef}
                      {...dropProvided.droppableProps}
                      className="divide-y"
                      style={{ borderColor: 'var(--bg-subtle)' }}
                    >
                      {entries.map((e, i) => {
                        const state = riderState(e);
                        const saving = pendingRiders.has(e.id);
                        return (
                          <Draggable key={e.id} draggableId={e.id} index={i}>
                            {(dragProvided, snapshot) => (
                              <li
                                ref={dragProvided.innerRef}
                                {...dragProvided.draggableProps}
                                className="py-2 flex items-center gap-2 flex-wrap"
                                style={{
                                  backgroundColor: snapshot.isDragging ? 'var(--warning-bg)' : 'transparent',
                                  opacity: saving ? 0.6 : 1,
                                  ...dragProvided.draggableProps.style,
                                }}
                              >
                                <span
                                  {...dragProvided.dragHandleProps}
                                  className="cursor-grab active:cursor-grabbing select-none shrink-0"
                                  title="Drag to reorder"
                                  aria-label="Drag to reorder"
                                  style={{ color: 'var(--border)' }}
                                >
                                  ⠿
                                </span>
                                <span className="w-6 text-right text-xs shrink-0" style={{ color: 'var(--muted)' }}>
                                  {i + 1}.
                                </span>
                                <span className="font-mono text-sm w-12 shrink-0" style={{ color: 'var(--foreground)' }}>
                                  {e.back_number ?? '—'}
                                </span>
                                <span
                                  className="text-sm flex-1 min-w-40"
                                  style={{
                                    color: state === 'no_show' ? 'var(--muted)' : 'var(--foreground)',
                                    textDecoration: state === 'no_show' ? 'line-through' : undefined,
                                  }}
                                >
                                  {e.exhibitor_name}
                                  {e.horse_name && <span style={{ color: 'var(--muted)' }}> · {e.horse_name}</span>}
                                  {e.is_disqualified && <span style={{ color: 'var(--error-strong)' }}> (DQ)</span>}
                                </span>
                                {isStarted ? (
                                  // The gate is finished with a class once it is in the ring.
                                  state !== 'waiting' && (
                                    <span
                                      className="text-xs px-2 py-0.5 rounded-full shrink-0"
                                      style={
                                        state === 'checked_in'
                                          ? { backgroundColor: 'var(--success-bg)', color: 'var(--success-strong)' }
                                          : { backgroundColor: 'var(--bg-subtle)', color: 'var(--muted)' }
                                      }
                                    >
                                      {state === 'checked_in' ? '✓' : 'No-show'}
                                    </span>
                                  )
                                ) : state === 'checked_in' ? (
                                  <button
                                    onClick={() => setRider(e.id, 'waiting')}
                                    disabled={saving}
                                    title="Checked in — tap to undo"
                                    aria-label="Checked in"
                                    className="text-sm px-3 py-1 rounded-full shrink-0 disabled:opacity-50"
                                    style={{ backgroundColor: 'var(--success-bg)', color: 'var(--success-strong)' }}
                                  >
                                    ✓ In
                                  </button>
                                ) : state === 'no_show' ? (
                                  <button
                                    onClick={() => setRider(e.id, 'waiting')}
                                    disabled={saving}
                                    title="Marked a no-show — tap to undo"
                                    className="text-sm px-3 py-1 rounded-full shrink-0 disabled:opacity-50"
                                    style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-deep)' }}
                                  >
                                    No-show
                                  </button>
                                ) : (
                                  <span className="flex gap-2 shrink-0">
                                    <button
                                      onClick={() => setRider(e.id, 'checked_in')}
                                      disabled={saving}
                                      className="text-sm px-3 py-1 rounded border disabled:opacity-50"
                                      style={{ borderColor: 'var(--success-border)', color: 'var(--success-strong)' }}
                                    >
                                      Check in
                                    </button>
                                    <button
                                      onClick={() => setRider(e.id, 'no_show')}
                                      disabled={saving}
                                      title="Called for and did not come. Not a scratch — the office or the exhibitor scratches."
                                      className="text-sm px-3 py-1 rounded border disabled:opacity-50"
                                      style={{ borderColor: 'var(--border)', color: 'var(--text-deep)' }}
                                    >
                                      No-show
                                    </button>
                                  </span>
                                )}
                              </li>
                            )}
                          </Draggable>
                        );
                      })}
                      {dropProvided.placeholder}
                    </ul>
                  )}
                </Droppable>
              </DragDropContext>
            )}

            {!isStarted && (counts.checkedIn > 0 || counts.noShow > 0) && (
              <div className="mt-3 pt-2 border-t" style={{ borderColor: 'var(--bg-subtle)' }}>
                {!confirmingReset ? (
                  <button
                    onClick={() => setConfirmingReset(true)}
                    disabled={busy}
                    title="Clear every check-in and no-show on this class"
                    className="text-xs hover:underline disabled:opacity-50"
                    style={{ color: 'var(--error-strong)' }}
                  >
                    Clear check-ins…
                  </button>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs" style={{ color: 'var(--error-strong)' }}>
                      Clear every check-in and no-show on this class?
                    </span>
                    <button
                      onClick={resetClass}
                      disabled={busy}
                      className="text-xs px-2 py-0.5 rounded text-white disabled:opacity-50"
                      style={{ backgroundColor: 'var(--error)' }}
                    >
                      {busy ? 'Clearing…' : 'Yes, clear'}
                    </button>
                    <button
                      onClick={() => setConfirmingReset(false)}
                      disabled={busy}
                      className="text-xs px-2 py-0.5 rounded border disabled:opacity-50"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-deep)' }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Classes (today only) ────────────────────────────────────────── */}
      <section className="p-4 rounded-lg border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
        <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
          Classes{activeDate ? ` — ${activeDate}` : ''}
        </h2>
        {dayClasses.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {classes.length === 0 ? 'No classes on this show yet.' : 'No classes scheduled for this day.'}
          </p>
        ) : (
          <ul className="space-y-1">
            {dayClasses.map(c => {
              const label = position(c);
              const n = countsFor(c);
              return (
                <li key={c.id}>
                  <button
                    onClick={() => setSelectedClassId(c.id)}
                    className="w-full flex items-center justify-between gap-2 text-left text-sm px-2 py-1 rounded border"
                    style={
                      c.id === selectedClassId
                        ? { borderColor: 'var(--accent)', backgroundColor: 'var(--warning-bg)', color: 'var(--foreground)' }
                        : { borderColor: 'var(--border-subtle)', backgroundColor: 'var(--background)', color: 'var(--text-deep)' }
                    }
                  >
                    <span className="truncate">
                      <span className="font-mono" style={{ color: 'var(--accent)' }}>#{c.class_number}</span>{' '}
                      {c.class_name}
                    </span>
                    <span className="flex gap-1 shrink-0">
                      {!started(c) && n.entries > 0 && (
                        c.gate_status === 'ready' ? (
                          <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent)' }}>
                            Ready
                          </span>
                        ) : (
                          <span
                            className="text-xs px-2 py-0.5 rounded-full"
                            title="Riders checked in or marked a no-show, of the riders in the class"
                            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-deep)' }}
                          >
                            {n.checkedIn + n.noShow}/{n.entries}
                          </span>
                        )
                      )}
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{
                          backgroundColor: POSITION_COLORS[label].bg,
                          color: POSITION_COLORS[label].fg,
                        }}
                      >
                        {label === 'Done' ? '✓ Done' : label}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
