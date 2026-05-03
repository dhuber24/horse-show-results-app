'use client';

import { useState } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import EditClassCard from './EditClassCard';

interface ShowType { id: string; code: string; name: string; }
interface Ring { id: string; name: string; }
interface Division { id: string; name: string; }

interface ClassItem {
  id: string;
  class_number: string;
  class_name: string;
  class_date: string;
  status: string;
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
  const [ordered, setOrdered] = useState<ClassItem[]>(initialClasses);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [savedIds, setSavedIds] = useState(() => initialClasses.map((c) => c.id).join(','));

  const currentIds = ordered.map((c) => c.id).join(',');
  const isDirty = currentIds !== savedIds;

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    if (result.destination.index === result.source.index) return;
    setSaveSuccess(false);
    setOrdered((prev) => {
      const next = [...prev];
      const [moved] = next.splice(result.source.index, 1);
      next.splice(result.destination!.index, 0, moved);
      return next;
    });
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

  return (
    <div className="space-y-2">
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
      {saveSuccess && (
        <p className="text-sm text-green-700 px-1">Schedule order saved.</p>
      )}
      {saveError && <p className="text-sm text-red-600 px-1">{saveError}</p>}
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="classes">
          {(provided) => (
            <ul
              {...provided.droppableProps}
              ref={provided.innerRef}
              className="space-y-2"
            >
              {ordered.map((cls, index) => (
                <Draggable key={cls.id} draggableId={cls.id} index={index}>
                  {(provided, snapshot) => (
                    <li
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      className="flex gap-1 items-start"
                      style={{
                        ...provided.draggableProps.style,
                        opacity: snapshot.isDragging ? 0.85 : 1,
                      }}
                    >
                      <div
                        {...provided.dragHandleProps}
                        className="pt-3.5 px-1 shrink-0 cursor-grab active:cursor-grabbing select-none"
                        title="Drag to reorder"
                        style={{ color: '#c9a96e' }}
                      >
                        ⠿
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
                    </li>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </ul>
          )}
        </Droppable>
      </DragDropContext>
    </div>
  );
}
