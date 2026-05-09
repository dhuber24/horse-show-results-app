'use client';

import { useState, useRef, useEffect, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { DragDropContext, Droppable, Draggable, DropResult, DragStart } from '@hello-pangea/dnd';

import EditClassCard from './EditClassCard';
import { getShowDates } from './showDateUtils';

function formatClassDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

interface ShowType { id: string; code: string; name: string; }
interface Ring { id: string; name: string; }
interface Division { id: string; name: string; }

interface ClassItem {
  id: string;
  class_number: string;
  class_name: string;
  class_date: string;
  status: string;
  score_type: 'placement' | 'pattern' | 'time';
  sort_order: number | null;
  ring_id: string | null;
  division_id: string | null;
  associations: any[];
}

export default function ClassListWithReorder({
  initialClasses,
  showId,
  showStartDate,
  showEndDate,
  showTypes,
  rings,
  divisions,
}: {
  initialClasses: ClassItem[];
  showId: string;
  showStartDate: string;
  showEndDate: string;
  showTypes: ShowType[];
  rings: Ring[];
  divisions: Division[];
}) {
  const router = useRouter();
  const [ordered, setOrdered] = useState<ClassItem[]>(initialClasses);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [savedIds, setSavedIds] = useState(() => initialClasses.map((c) => c.id).join(','));

  // Re-sync from server when initialClasses changes (e.g. after a class edit
  // calls router.refresh()). Preserve a pending drag-reorder when the set of
  // class IDs is unchanged so the user doesn't lose unsaved order tweaks.
  useEffect(() => {
    setOrdered((prev) => {
      const prevIdSet = new Set(prev.map((c) => c.id));
      const sameSet =
        prev.length === initialClasses.length &&
        initialClasses.every((c) => prevIdSet.has(c.id));
      if (!sameSet) return initialClasses;
      const byId = new Map(initialClasses.map((c) => [c.id, c]));
      return prev.map((c) => byId.get(c.id) ?? c);
    });
  }, [initialClasses]);
  const [dragError, setDragError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');

  const currentIds = ordered.map((c) => c.id).join(',');
  const isDirty = currentIds !== savedIds;

  const isFiltering = filterText.trim().length > 0;
  const filteredOrdered = isFiltering
    ? ordered.filter((c) =>
        c.class_name.toLowerCase().includes(filterText.toLowerCase()) ||
        c.class_number.toLowerCase().includes(filterText.toLowerCase())
      )
    : ordered;

  // ── Select-all checkbox (indeterminate state scoped to visible items) ──────

  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selectAllRef.current) return;
    const visibleIds = filteredOrdered.map((c) => c.id);
    const selectedCount = visibleIds.filter((id) => selectedIds.has(id)).length;
    const all = visibleIds.length > 0 && selectedCount === visibleIds.length;
    const some = selectedCount > 0 && selectedCount < visibleIds.length;
    selectAllRef.current.checked = all;
    selectAllRef.current.indeterminate = some;
  }, [selectedIds, filteredOrdered]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    const visibleIds = filteredOrdered.map((c) => c.id);
    const allVisible = visibleIds.every((id) => selectedIds.has(id));
    if (allVisible) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.delete(id));
        return next;
      });
      setConfirmBulkDelete(false);
      setBulkDeleteError(null);
    } else {
      setSelectedIds((prev) => new Set([...prev, ...visibleIds]));
    }
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
    setConfirmBulkDelete(false);
    setBulkDeleteError(null);
  };

  // ── Bulk delete ───────────────────────────────────────────────────────────

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    setBulkDeleteError(null);
    const results = await Promise.all(
      [...selectedIds].map((classId) =>
        fetch('/api/classes', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ showId, classId }),
        })
      )
    );
    setBulkDeleting(false);
    const failed = results.filter((r) => !r.ok).length;
    if (failed > 0) {
      setBulkDeleteError(`${failed} class${failed > 1 ? 'es' : ''} could not be deleted.`);
    } else {
      setSelectedIds(new Set());
      setConfirmBulkDelete(false);
      router.refresh();
    }
  };

  // ── Drag and drop ─────────────────────────────────────────────────────────

  const handleDragStart = (_: DragStart) => {
    setDragError(null);
  };

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    if (result.destination.index === result.source.index) return;
    setSaveSuccess(false);

    const dragged = ordered[result.source.index];
    const next = [...ordered];
    const [moved] = next.splice(result.source.index, 1);
    next.splice(result.destination.index, 0, moved);

    const destIdx = result.destination.index;
    const prev = destIdx > 0 ? next[destIdx - 1] : null;
    const after = destIdx < next.length - 1 ? next[destIdx + 1] : null;
    const hasMatchingNeighbor =
      prev?.class_date === dragged.class_date ||
      after?.class_date === dragged.class_date;

    if (!hasMatchingNeighbor) {
      setDragError(
        `"${dragged.class_name}" is scheduled for ${formatClassDate(dragged.class_date)} and can only be reordered within that day. Edit the class to change its date.`
      );
      return;
    }

    setOrdered(next);
  };

  const handleSaveOrder = async () => {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    const res = await fetch(`/api/shows/${showId}/classes/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ class_ids: ordered.map((c) => c.id) }),
    });
    setSaving(false);
    if (res.ok) {
      setSavedIds(currentIds);
      setSaveSuccess(true);
    } else {
      const err = await res.json().catch(() => ({}));
      setSaveError(err.detail ?? 'Failed to save order.');
    }
  };

  // ── Shared date-header renderer ───────────────────────────────────────────

  const DateHeader = ({ cls, index, list }: { cls: ClassItem; index: number; list: ClassItem[] }) => {
    const show = index === 0 || list[index - 1].class_date !== cls.class_date;
    if (!show) return null;
    return (
      <li className={`${index > 0 ? 'pt-4' : ''} pb-1 select-none pointer-events-none`}>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-px" style={{ backgroundColor: '#e8d5b7' }} />
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ color: '#8b4513', backgroundColor: '#f0e8d8' }}>
            {formatClassDate(cls.class_date)}
          </span>
          <div className="flex-1 h-px" style={{ backgroundColor: '#e8d5b7' }} />
        </div>
      </li>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-2">
      {/* Order / save banners */}
      {isDirty && (
        <div className="flex items-center gap-3 p-3 rounded-lg border" style={{ borderColor: '#c9a96e', backgroundColor: '#fffdf8' }}>
          <span className="text-sm flex-1" style={{ color: '#5c3d1e' }}>Order changed — save to apply.</span>
          <button
            onClick={handleSaveOrder}
            disabled={saving}
            title={saving ? 'Saving, please wait…' : undefined}
            className="px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
          >
            {saving ? 'Saving…' : 'Save Order'}
          </button>
        </div>
      )}
      {saveSuccess && <p className="text-sm text-green-700 px-1">Schedule order saved.</p>}
      {saveError && <p className="text-sm text-red-600 px-1">{saveError}</p>}

      {/* Drag error */}
      {dragError && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-red-200 bg-red-50">
          <span className="text-sm text-red-700 flex-1">{dragError}</span>
          <button onClick={() => setDragError(null)} className="text-red-400 hover:text-red-600 shrink-0 leading-none" title="Dismiss">✕</button>
        </div>
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-red-200 bg-red-50 flex-wrap">
          <span className="text-sm font-medium text-red-800 flex-1">
            {selectedIds.size} class{selectedIds.size > 1 ? 'es' : ''} selected
          </span>
          {confirmBulkDelete ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-red-800">
                Delete {selectedIds.size} class{selectedIds.size > 1 ? 'es' : ''} and all their entries?
              </span>
              <button onClick={handleBulkDelete} disabled={bulkDeleting}
                className="text-xs text-red-600 hover:underline disabled:opacity-50 font-medium">
                {bulkDeleting ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button onClick={() => { setConfirmBulkDelete(false); setBulkDeleteError(null); }} disabled={bulkDeleting}
                className="text-xs hover:underline" style={{ color: '#8b7355' }}>
                Cancel
              </button>
              {bulkDeleteError && <span className="text-xs text-red-600 w-full">{bulkDeleteError}</span>}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button onClick={() => setConfirmBulkDelete(true)} className="text-sm text-red-600 hover:text-red-800 font-medium">
                Delete selected
              </button>
              <button onClick={deselectAll} className="text-sm hover:underline" style={{ color: '#8b7355' }}>
                Deselect all
              </button>
            </div>
          )}
        </div>
      )}

      {/* Filter input */}
      <div className="relative">
        <input
          type="text"
          placeholder="Filter by class name or number…"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm pr-8"
          style={{ borderColor: '#d4b896' }}
        />
        {filterText && (
          <button
            onClick={() => setFilterText('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            title="Clear filter"
          >
            ✕
          </button>
        )}
      </div>

      {/* Select-all row + match count */}
      <div className="flex items-center gap-1 px-1 pb-1">
        <input
          ref={selectAllRef}
          type="checkbox"
          onChange={handleSelectAll}
          className="w-3.5 h-3.5 cursor-pointer accent-red-600"
          title="Select all visible classes"
        />
        <label onClick={handleSelectAll} className="text-xs cursor-pointer select-none" style={{ color: '#8b7355' }}>
          Select all
        </label>
        {isFiltering && (
          <span className="text-xs ml-2" style={{ color: '#8b7355' }}>
            — {filteredOrdered.length} of {ordered.length} shown
            {filteredOrdered.length === 0 && ' · no matches'}
          </span>
        )}
        {isFiltering && (
          <span className="text-xs ml-auto" style={{ color: '#c9a96e' }}>
            Reorder disabled while filtering
          </span>
        )}
      </div>

      {/* Filtered list (non-draggable) */}
      {isFiltering && (
        <ul className="space-y-2">
          {filteredOrdered.length === 0 ? (
            <li className="text-sm px-1" style={{ color: '#8b7355' }}>No classes match.</li>
          ) : (
            filteredOrdered.map((cls, index) => (
              <Fragment key={cls.id}>
                <DateHeader cls={cls} index={index} list={filteredOrdered} />
                <li className="flex gap-1 items-start">
                  <div className="pt-3.5 px-1 shrink-0">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(cls.id)}
                      onChange={() => toggleSelect(cls.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-3.5 h-3.5 cursor-pointer accent-red-600"
                      title="Select class"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <EditClassCard
                      cls={cls}
                      position={ordered.indexOf(cls) + 1}
                      showId={showId}
                      showStartDate={showStartDate}
                      showEndDate={showEndDate}
                      showTypes={showTypes}
                      rings={rings}
                      divisions={divisions}
                    />
                  </div>
                </li>
              </Fragment>
            ))
          )}
        </ul>
      )}

      {/* Full draggable list */}
      {!isFiltering && (
        <DragDropContext onDragEnd={handleDragEnd} onDragStart={handleDragStart}>
          <Droppable droppableId="classes">
            {(provided) => (
              <ul {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                {ordered.map((cls, index) => (
                  <Fragment key={cls.id}>
                    <DateHeader cls={cls} index={index} list={ordered} />
                    <Draggable draggableId={cls.id} index={index}>
                      {(provided, snapshot) => (
                        <li
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          className="flex gap-1 items-start"
                          style={{ ...provided.draggableProps.style, opacity: snapshot.isDragging ? 0.85 : 1 }}
                        >
                          <div className="pt-3.5 px-1 shrink-0">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(cls.id)}
                              onChange={() => toggleSelect(cls.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="w-3.5 h-3.5 cursor-pointer accent-red-600"
                              title="Select class"
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <EditClassCard
                              cls={cls}
                              position={index + 1}
                              showId={showId}
                              showStartDate={showStartDate}
                              showEndDate={showEndDate}
                              showTypes={showTypes}
                              rings={rings}
                              divisions={divisions}
                            />
                          </div>
                          <div
                            {...provided.dragHandleProps}
                            className="pt-3.5 px-1 shrink-0 cursor-grab active:cursor-grabbing select-none"
                            title="Drag to reorder"
                            style={{ color: '#c9a96e' }}
                          >
                            ⠿
                          </div>
                        </li>
                      )}
                    </Draggable>
                  </Fragment>
                ))}
                {provided.placeholder}
              </ul>
            )}
          </Droppable>
        </DragDropContext>
      )}
    </div>
  );
}
