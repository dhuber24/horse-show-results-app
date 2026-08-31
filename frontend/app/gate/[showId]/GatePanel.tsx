'use client';

import { useCallback, useEffect, useState } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import ConfirmDialog from '@/components/ConfirmDialog';

type GateClassStatus = 'pending' | 'ready' | 'in_progress' | 'done';

type ClassRow = {
  id: string;
  class_number: string;
  class_name: string;
  class_date: string;
  status: string;
  ring_id: string | null;
  gate_status: GateClassStatus;
  score_type?: string;
  /** When the judge posted this class’s pattern (migration 120). */
  pattern_posted_at?: string | null;
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
};

type ClassGateLabel = 'Done' | 'In progress' | 'Ready' | 'On deck' | 'Waiting';

const CLASS_STATUS_COLORS: Record<ClassGateLabel, { bg: string; fg: string }> = {
  Done: { bg: '#e8e8e8', fg: '#555' },
  'In progress': { bg: '#e3f0e3', fg: '#1f4e1f' },
  Ready: { bg: '#e3ecf7', fg: '#1d4ed8' },
  'On deck': { bg: '#fdf3d7', fg: '#8a6106' },
  Waiting: { bg: '#f3ede2', fg: '#5a3e2b' },
};

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

export default function GatePanel({ showId, classes: initialClasses }: { showId: string; classes: ClassRow[] }) {
  const [classes, setClasses] = useState<ClassRow[]>(initialClasses);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [entries, setEntries] = useState<GateEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [error, setError] = useState('');
  const [showProceedPrompt, setShowProceedPrompt] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [confirmingSkip, setConfirmingSkip] = useState(false);
  const [ringConflict, setRingConflict] = useState<{ id: string; number: string; name: string } | null>(null);

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

  // Class gate lifecycle: pending → ready (all checked in, set server-side)
  // → in_progress (steward saw the first horse enter the ring) → done.
  // "On deck" is derived per ring: each ring's first not-yet-started class of
  // the day. Check-in is only open for on-deck classes (enforced server-side
  // too).
  const nextUp = dayClasses.find(c => c.gate_status === 'pending' || c.gate_status === 'ready') ?? null;
  const onDeckIds = new Set<string>();
  {
    const ringsSeen = new Set<string>();
    for (const c of dayClasses) {
      if (c.gate_status !== 'pending' && c.gate_status !== 'ready') continue;
      const ringKey = c.ring_id ?? 'no-ring';
      if (!ringsSeen.has(ringKey)) {
        ringsSeen.add(ringKey);
        onDeckIds.add(c.id);
      }
    }
  }

  function classLabel(c: ClassRow): ClassGateLabel {
    if (c.gate_status === 'done') return 'Done';
    if (c.gate_status === 'in_progress') return 'In progress';
    if (c.gate_status === 'ready') return 'Ready';
    if (onDeckIds.has(c.id)) return 'On deck';
    return 'Waiting';
  }

  // Auto-queue: default the Order of Go to the next class of the day that
  // hasn't started. The steward can still pick any class from the list.
  useEffect(() => {
    if (!selectedClassId && nextUp) setSelectedClassId(nextUp.id);
  }, [selectedClassId, nextUp]);

  const loadEntries = useCallback(async (classId: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/shows/${showId}/gate/classes/${classId}/entries`);
      const json = await res.json();
      if (!res.ok) {
        setError(json?.detail || 'Failed to load entries');
        setEntries([]);
        return;
      }
      setEntries(json);
    } finally {
      setLoading(false);
    }
  }, [showId]);

  useEffect(() => {
    if (selectedClassId) loadEntries(selectedClassId);
    setConfirmingReset(false);
    setConfirmingSkip(false);
  }, [selectedClassId, loadEntries]);

  // Drag-and-drop reorder with optimistic update and auto-save on drop,
  // matching the class wizard's reorder behavior. On failure the list is
  // refreshed from the server so it never shows an unsaved order.
  async function handleDragEnd(result: DropResult) {
    const { source, destination } = result;
    if (!destination || destination.index === source.index) return;
    if (!selectedClassId) return;

    const reordered = [...entries];
    const [moved] = reordered.splice(source.index, 1);
    reordered.splice(destination.index, 0, moved);
    setEntries(reordered.map((e, i) => ({ ...e, gate_order: i + 1 })));

    setError('');
    setSavingOrder(true);
    try {
      const res = await fetch(`/api/shows/${showId}/gate/classes/${selectedClassId}/order`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry_ids: reordered.map(e => e.id) }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.detail || 'Failed to save the new order.');
        await loadEntries(selectedClassId);
        return;
      }
      setEntries(json);
    } finally {
      setSavingOrder(false);
    }
  }

  async function setCheckIn(entryId: string, checkedIn: boolean) {
    if (!selectedClassId) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(
        `/api/shows/${showId}/gate/classes/${selectedClassId}/entries/${entryId}/check-in`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checked_in: checkedIn }),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        setError(json?.detail || 'Failed to update check-in');
        return;
      }
      setEntries(prev => prev.map(e => (e.id === entryId ? json.entry : e)));
      setClasses(prev =>
        prev.map(c =>
          c.id === selectedClassId ? { ...c, gate_status: json.class_gate_status } : c,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function setClassStatus(classId: string, gateStatus: GateClassStatus): Promise<boolean> {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/shows/${showId}/gate/classes/${classId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gate_status: gateStatus }),
      });
      if (!res.ok && res.status !== 204) {
        const j = await res.json().catch(() => null);
        const detail = j?.detail;
        setError(
          typeof detail === 'string'
            ? detail
            : detail?.message || 'Failed to update the class status.',
        );
        return false;
      }
      setClasses(prev => prev.map(c => (c.id === classId ? { ...c, gate_status: gateStatus } : c)));
      return true;
    } finally {
      setBusy(false);
    }
  }

  // The steward waits until the first exhibitor is in the ring, then starts
  // the class; the proceed-to-next-class prompt follows immediately. Only one
  // class per ring can be in progress — the backend answers 409 with the
  // conflicting class, and we ask the steward whether that class is finished.
  // Answering that conflict prompt already covers "proceed", so the start it
  // triggers advances to the next class without asking again.
  async function requestStart(classId: string, promptToProceed = true) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/shows/${showId}/gate/classes/${classId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gate_status: 'in_progress' }),
      });
      if (res.ok || res.status === 204) {
        setClasses(prev =>
          prev.map(c => (c.id === classId ? { ...c, gate_status: 'in_progress' } : c)),
        );
        if (promptToProceed) {
          setShowProceedPrompt(true);
        } else {
          proceedToNextClass();
        }
        return;
      }
      const j = await res.json().catch(() => null);
      const detail = j?.detail;
      if (res.status === 409 && detail && typeof detail === 'object' && detail.conflict_class_id) {
        setRingConflict({
          id: detail.conflict_class_id,
          number: detail.conflict_class_number,
          name: detail.conflict_class_name,
        });
        return;
      }
      setError(typeof detail === 'string' ? detail : 'Failed to start the class.');
    } finally {
      setBusy(false);
    }
  }

  function startClass() {
    if (selectedClassId) void requestStart(selectedClassId);
  }

  async function finishPreviousAndStart() {
    if (!ringConflict || !selectedClassId) return;
    if (await setClassStatus(ringConflict.id, 'done')) {
      setRingConflict(null);
      await requestStart(selectedClassId, false);
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
    try {
      const res = await fetch(`/api/shows/${showId}/gate/classes/${selectedClassId}/pattern`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ posted }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.detail || 'Failed to record the pattern.');
        return;
      }
      setClasses(prev =>
        prev.map(c =>
          c.id === selectedClassId ? { ...c, pattern_posted_at: json.pattern_posted_at } : c,
        ),
      );
    } catch {
      setError('Network error — please try again.');
    } finally {
      setBusy(false);
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
    try {
      const res = await fetch(`/api/shows/${showId}/gate/classes/${selectedClassId}/draw`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.detail || 'Failed to draw the order of go.');
        return;
      }
      setEntries(json);
    } catch {
      setError('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  // Full reset: clears all check-ins and returns the class to Waiting.
  async function resetClass() {
    if (!selectedClassId) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/shows/${showId}/gate/classes/${selectedClassId}/reset`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.detail || 'Failed to reset the class.');
        return;
      }
      setEntries(json);
      setClasses(prev =>
        prev.map(c => (c.id === selectedClassId ? { ...c, gate_status: 'pending' } : c)),
      );
    } finally {
      setBusy(false);
      setConfirmingReset(false);
    }
  }

  // Skip an empty class: a class with no entries can never reach "ready"
  // (which needs at least one checked-in exhibitor), so it would otherwise
  // block the ring forever. Marking it done clears it and advances the ring.
  async function skipClass() {
    if (!selectedClassId) return;
    if (await setClassStatus(selectedClassId, 'done')) {
      setConfirmingSkip(false);
      proceedToNextClass();
    }
  }

  function proceedToNextClass() {
    setShowProceedPrompt(false);
    const upNext = dayClasses.find(
      c => c.id !== selectedClassId && (c.gate_status === 'pending' || c.gate_status === 'ready'),
    );
    setSelectedClassId(upNext ? upNext.id : null);
    if (!upNext) setEntries([]);
  }

  const selectedClass = classes.find(c => c.id === selectedClassId) || null;
  const checkedInCount = entries.filter(e => e.gate_checked_in).length;
  const canCheckIn = selectedClass != null && onDeckIds.has(selectedClass.id);
  const upNextAfterSelected = dayClasses.find(
    c => c.id !== selectedClassId && (c.gate_status === 'pending' || c.gate_status === 'ready'),
  );

  return (
    <div className="space-y-5">
      {ringConflict && selectedClass && (
        <ConfirmDialog
          title="Is the previous class finished?"
          message={`#${ringConflict.number} ${ringConflict.name} is still in progress in this ring. Has it finished? Answering yes marks it done and starts #${selectedClass.class_number} ${selectedClass.class_name}.`}
          confirmLabel="Yes — mark it done and start"
          confirming={busy}
          onConfirm={finishPreviousAndStart}
          onCancel={() => setRingConflict(null)}
        />
      )}

      {confirmingSkip && selectedClass && (
        <ConfirmDialog
          title="Skip this class?"
          message={
            `#${selectedClass.class_number} ${selectedClass.class_name} has no entries at the gate. ` +
            `Skip it and mark it done?` +
            (upNextAfterSelected
              ? ` You'll move on to #${upNextAfterSelected.class_number} ${upNextAfterSelected.class_name}.`
              : '')
          }
          confirmLabel="Skip class"
          confirming={busy}
          onConfirm={skipClass}
          onCancel={() => setConfirmingSkip(false)}
        />
      )}

      {showProceedPrompt && selectedClass && (
        <ConfirmDialog
          title="Class in progress"
          message={`#${selectedClass.class_number} ${selectedClass.class_name} is now in progress. Would you like to proceed to the next class?`}
          confirmLabel={upNextAfterSelected ? 'Proceed to next class' : 'Done for now'}
          confirming={busy}
          onConfirm={proceedToNextClass}
          onCancel={() => setShowProceedPrompt(false)}
        />
      )}

      {/* ── Order of Go ─────────────────────────────────────────────────── */}
      <section className="p-4 rounded-lg border" style={{ borderColor: '#d4b896', backgroundColor: '#fff' }}>
        {!selectedClass ? (
          <div>
            <h2 className="text-sm font-semibold mb-1" style={{ color: '#2c1810' }}>Order of go</h2>
            <p className="text-sm" style={{ color: '#8b7355' }}>
              {dayClasses.length === 0
                ? 'No classes scheduled for this day.'
                : 'Every class today has started or finished. Pick a class below to review it.'}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h2 className="text-sm font-semibold" style={{ color: '#2c1810' }}>
                Order of go — #{selectedClass.class_number} {selectedClass.class_name}
              </h2>
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: CLASS_STATUS_COLORS[classLabel(selectedClass)].bg,
                  color: CLASS_STATUS_COLORS[classLabel(selectedClass)].fg,
                }}
              >
                {classLabel(selectedClass)}
              </span>
              {entries.length > 1 && (
                <>
                  <span className="text-xs" style={{ color: '#d4b896' }}>· drag to reorder</span>
                  <button
                    type="button"
                    onClick={drawOrder}
                    disabled={busy}
                    title="Draw the order of go at random (APHA SC-185.I). You can still drag afterwards."
                    className="text-xs underline disabled:opacity-50"
                    style={{ color: '#8b4513' }}
                  >
                    · draw order
                  </button>
                </>
              )}
              {savingOrder && (
                <span className="text-xs" style={{ color: '#1f4e1f' }}>· saving…</span>
              )}
            </div>
            {selectedClass.score_type === 'pattern' && (
              <div
                className="text-xs mb-3 rounded px-2 py-1.5 flex items-center gap-2 flex-wrap"
                style={{ backgroundColor: selectedClass.pattern_posted_at ? '#ecfdf5' : '#faf7f2', border: `1px solid ${selectedClass.pattern_posted_at ? '#a7f3d0' : '#e8d5b7'}` }}
              >
                <span style={{ color: selectedClass.pattern_posted_at ? '#065f46' : '#8b7355' }}>
                  {selectedClass.pattern_posted_at
                    ? `✓ Pattern posted ${formatPosted(selectedClass.pattern_posted_at)}`
                    : 'Pattern not yet posted — the rules require it an hour before the class.'}
                </span>
                <button
                  type="button"
                  onClick={() => setPatternPosted(!selectedClass.pattern_posted_at)}
                  disabled={busy}
                  className="underline disabled:opacity-50"
                  style={{ color: '#8b4513' }}
                >
                  {selectedClass.pattern_posted_at ? 'Undo' : 'Mark posted'}
                </button>
              </div>
            )}
            {selectedClass.procedure_note && (
              <p
                className="text-xs mb-3 rounded px-2 py-1.5"
                style={{ backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }}
              >
                ⚠ {selectedClass.procedure_note}
              </p>
            )}
            <p className="text-xs mb-3" style={{ color: '#8b7355' }}>
              {entries.length === 0
                ? 'No entries in this class.'
                : `${checkedInCount} of ${entries.length} checked in at the gate`}
              {!canCheckIn && selectedClass.gate_status === 'pending' &&
                ' · Check-in opens when this class is on deck'}
              {upNextAfterSelected &&
                ` · Up next: #${upNextAfterSelected.class_number} ${upNextAfterSelected.class_name}`}
            </p>

            {!loading && entries.length === 0 && selectedClass.gate_status !== 'done' && (
              <div
                className="rounded border p-3 mb-3 flex items-center justify-between gap-2 flex-wrap"
                style={{ borderColor: '#e0c99a', backgroundColor: '#fdf7e8' }}
              >
                <p className="text-sm" style={{ color: '#8a6106' }}>
                  This class has no entries at the gate. Skip it to move on to the next class.
                </p>
                <button
                  onClick={() => setConfirmingSkip(true)}
                  disabled={busy}
                  className="text-sm px-3 py-1 rounded text-white disabled:opacity-50 shrink-0"
                  style={{ backgroundColor: '#8a6106' }}
                >
                  Skip class
                </button>
              </div>
            )}

            {selectedClass.gate_status === 'ready' && (
              <div
                className="rounded border p-3 mb-3 flex items-center justify-between gap-2 flex-wrap"
                style={{ borderColor: '#b8cce4', backgroundColor: '#eef3fa' }}
              >
                <p className="text-sm" style={{ color: '#1d4ed8' }}>
                  All exhibitors are checked in. Wait for the first exhibitor to enter the ring, then start the class.
                </p>
                <button
                  onClick={startClass}
                  disabled={busy}
                  className="text-sm px-3 py-1 rounded text-white disabled:opacity-50 shrink-0"
                  style={{ backgroundColor: '#1d4ed8' }}
                >
                  {busy ? 'Starting…' : 'First exhibitor in the ring — start class'}
                </button>
              </div>
            )}

            {selectedClass.gate_status === 'in_progress' && (
              <div
                className="rounded border p-3 mb-3 flex items-center justify-between gap-2 flex-wrap"
                style={{ borderColor: '#7fa97f', backgroundColor: '#eef7ee' }}
              >
                <p className="text-sm" style={{ color: '#1f4e1f' }}>
                  This class is in progress in the ring.
                </p>
                <span className="flex gap-2 shrink-0">
                  <button
                    onClick={() => selectedClassId && setClassStatus(selectedClassId, 'ready')}
                    disabled={busy}
                    title="Started by mistake? Return the class to Ready"
                    className="text-xs px-3 py-1 rounded border disabled:opacity-50"
                    style={{ borderColor: '#d4b896', color: '#5a3e2b', backgroundColor: '#fff' }}
                  >
                    Undo start
                  </button>
                  <button
                    onClick={async () => {
                      if (selectedClassId && (await setClassStatus(selectedClassId, 'done'))) {
                        proceedToNextClass();
                      }
                    }}
                    disabled={busy}
                    className="text-xs px-3 py-1 rounded border disabled:opacity-50"
                    style={{ borderColor: '#7fa97f', color: '#1f4e1f', backgroundColor: '#fff' }}
                  >
                    Mark class done
                  </button>
                </span>
              </div>
            )}

            {selectedClass.gate_status === 'done' && (
              <div
                className="rounded border p-3 mb-3 flex items-center justify-between gap-2 flex-wrap"
                style={{ borderColor: '#d4b896', backgroundColor: '#f7f3ec' }}
              >
                <p className="text-sm" style={{ color: '#5a3e2b' }}>
                  This class is done at the gate.
                </p>
                <button
                  onClick={() => selectedClassId && setClassStatus(selectedClassId, 'in_progress')}
                  disabled={busy}
                  title="Completed by mistake? Return the class to In progress"
                  className="text-xs px-3 py-1 rounded border disabled:opacity-50"
                  style={{ borderColor: '#d4b896', color: '#5a3e2b', backgroundColor: '#fff' }}
                >
                  Reopen class
                </button>
              </div>
            )}

            {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
            {loading ? (
              <p className="text-sm" style={{ color: '#8b7355' }}>Loading entries…</p>
            ) : entries.length > 0 && (
              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="gate-order">
                  {(dropProvided) => (
                    <ul
                      ref={dropProvided.innerRef}
                      {...dropProvided.droppableProps}
                      className="divide-y"
                      style={{ borderColor: '#f0e6d6' }}
                    >
                      {entries.map((e, i) => (
                        <Draggable key={e.id} draggableId={e.id} index={i}>
                          {(dragProvided, snapshot) => (
                            <li
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              className="py-2 flex items-center gap-2 flex-wrap"
                              style={{
                                backgroundColor: snapshot.isDragging ? '#fdf8eb' : 'transparent',
                                ...dragProvided.draggableProps.style,
                              }}
                            >
                              <span
                                {...dragProvided.dragHandleProps}
                                className="cursor-grab active:cursor-grabbing select-none shrink-0"
                                title="Drag to reorder"
                                aria-label="Drag to reorder"
                                style={{ color: '#d4b896' }}
                              >
                                ⠿
                              </span>
                              <span className="w-6 text-right text-xs shrink-0" style={{ color: '#8b7355' }}>
                                {i + 1}.
                              </span>
                              <span className="font-mono text-sm w-12 shrink-0" style={{ color: '#2c1810' }}>
                                {e.back_number ?? '—'}
                              </span>
                              <span className="text-sm flex-1 min-w-40" style={{ color: '#2c1810' }}>
                                {e.exhibitor_name}
                                {e.horse_name && <span style={{ color: '#8b7355' }}> · {e.horse_name}</span>}
                                {e.is_disqualified && <span className="text-red-600"> (DQ)</span>}
                              </span>
                              {e.gate_checked_in ? (
                                <button
                                  onClick={() => setCheckIn(e.id, false)}
                                  disabled={busy || !canCheckIn}
                                  title={
                                    canCheckIn
                                      ? 'Checked in with the gate steward — click to undo'
                                      : 'Checked in — check-in can only be changed while the class is on deck'
                                  }
                                  aria-label="Checked in"
                                  className="text-sm px-2 py-0.5 rounded-full shrink-0 disabled:opacity-50"
                                  style={{ backgroundColor: '#e3f0e3', color: '#1f4e1f' }}
                                >
                                  ✓
                                </button>
                              ) : (
                                <button
                                  onClick={() => setCheckIn(e.id, true)}
                                  disabled={busy || !canCheckIn}
                                  title={
                                    canCheckIn
                                      ? 'Mark this exhibitor as checked in at the gate'
                                      : 'Check-in opens when this class is on deck'
                                  }
                                  className="text-xs px-2 py-0.5 rounded border shrink-0 disabled:opacity-50"
                                  style={{ borderColor: '#7fa97f', color: '#1f4e1f' }}
                                >
                                  Check in
                                </button>
                              )}
                            </li>
                          )}
                        </Draggable>
                      ))}
                      {dropProvided.placeholder}
                    </ul>
                  )}
                </Droppable>
              </DragDropContext>
            )}

            {(selectedClass.gate_status !== 'pending' || checkedInCount > 0) && (
              <div className="mt-3 pt-2 border-t" style={{ borderColor: '#f0e6d6' }}>
                {!confirmingReset ? (
                  <button
                    onClick={() => setConfirmingReset(true)}
                    disabled={busy}
                    title="Clear every check-in and return this class to Waiting"
                    className="text-xs text-red-600 hover:underline disabled:opacity-50"
                  >
                    Reset class…
                  </button>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs" style={{ color: '#8b1a1a' }}>
                      Clear all check-ins and return this class to Waiting?
                    </span>
                    <button
                      onClick={resetClass}
                      disabled={busy}
                      className="text-xs px-2 py-0.5 rounded text-white disabled:opacity-50"
                      style={{ backgroundColor: '#b91c1c' }}
                    >
                      {busy ? 'Resetting…' : 'Yes, reset'}
                    </button>
                    <button
                      onClick={() => setConfirmingReset(false)}
                      disabled={busy}
                      className="text-xs px-2 py-0.5 rounded border disabled:opacity-50"
                      style={{ borderColor: '#d4b896', color: '#5a3e2b' }}
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
      <section className="p-4 rounded-lg border" style={{ borderColor: '#d4b896', backgroundColor: '#fff' }}>
        <h2 className="text-sm font-semibold mb-2" style={{ color: '#2c1810' }}>
          Classes{activeDate ? ` — ${activeDate}` : ''}
        </h2>
        {dayClasses.length === 0 ? (
          <p className="text-sm" style={{ color: '#8b7355' }}>
            {classes.length === 0 ? 'No classes on this show yet.' : 'No classes scheduled for this day.'}
          </p>
        ) : (
          <ul className="space-y-1">
            {dayClasses.map(c => {
              const label = classLabel(c);
              return (
                <li key={c.id}>
                  <button
                    onClick={() => setSelectedClassId(c.id)}
                    className="w-full flex items-center justify-between gap-2 text-left text-sm px-2 py-1 rounded border"
                    style={
                      c.id === selectedClassId
                        ? { borderColor: '#8b4513', backgroundColor: '#fdf8eb', color: '#2c1810' }
                        : { borderColor: '#e8dcc8', backgroundColor: '#faf7f2', color: '#5a3e2b' }
                    }
                  >
                    <span className="truncate">
                      <span className="font-mono" style={{ color: '#8b4513' }}>#{c.class_number}</span>{' '}
                      {c.class_name}
                    </span>
                    <span
                      className="text-xs px-2 py-0.5 rounded-full shrink-0"
                      style={{
                        backgroundColor: CLASS_STATUS_COLORS[label].bg,
                        color: CLASS_STATUS_COLORS[label].fg,
                      }}
                    >
                      {label === 'Done' ? '✓ Done' : label}
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
