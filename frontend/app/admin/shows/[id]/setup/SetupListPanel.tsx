'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type ScoreType = 'placement' | 'pattern' | 'time';

export type SetupItem = {
  id: string;
  name: string;
  sort_order: number | null;
  class_count: number;
  default_score_type?: ScoreType;
};

type StandardOption = { id: string; name: string; default_score_type?: ScoreType };

type Props = {
  kind: 'ring' | 'division' | 'section';
  showId: string;
  items: SetupItem[];
  standardOptions: StandardOption[];
  title: string;
  emptyHint: string;
  pickerHint: string;
};

const SCORE_TYPE_LABEL: Record<ScoreType, string> = {
  placement: 'Placement',
  pattern: 'Pattern',
  time: 'Timed',
};

const SCORE_TYPE_OPTIONS: { value: ScoreType; label: string; hint: string }[] = [
  { value: 'placement', label: 'Placement', hint: 'Judge ranks horses (rail, halter)' },
  { value: 'pattern', label: 'Pattern', hint: 'Numeric scores (showmanship, reining)' },
  { value: 'time', label: 'Timed', hint: 'Clocked event (barrels, poles)' },
];

const COLLECTION_SEGMENT: Record<Props['kind'], string> = {
  ring: 'rings',
  division: 'divisions',
  section: 'sections',
};

export default function SetupListPanel({
  kind,
  showId,
  items,
  standardOptions,
  title,
  emptyHint,
  pickerHint,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editScoreType, setEditScoreType] = useState<ScoreType>('placement');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customScoreType, setCustomScoreType] = useState<ScoreType>('placement');

  const [showPicker, setShowPicker] = useState(false);
  const [pickedNames, setPickedNames] = useState<Set<string>>(new Set());

  const collectionPath = `/api/shows/${showId}/${COLLECTION_SEGMENT[kind]}`;
  const itemPath = (id: string) => `${collectionPath}/${id}`;

  const usedNames = useMemo(
    () => new Set(items.map((i) => i.name.toLowerCase())),
    [items],
  );
  const availableStandards = useMemo(
    () => standardOptions.filter((s) => !usedNames.has(s.name.toLowerCase())),
    [standardOptions, usedNames],
  );

  async function handleSubmitCustom() {
    const name = customName.trim();
    if (!name) return;
    setError(null);
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name };
      if (kind === 'division') body.default_score_type = customScoreType;
      const res = await fetch(collectionPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = res.status === 204 ? null : await res.json();
      if (!res.ok) {
        setError(json?.detail || `Failed to add ${kind}`);
        return;
      }
      setCustomName('');
      setCustomScoreType('placement');
      setShowCustomForm(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleAddPicked() {
    const names = Array.from(pickedNames);
    if (names.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(collectionPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
      });
      const json = res.status === 204 ? null : await res.json();
      if (!res.ok) {
        setError(json?.detail || `Failed to add ${kind}s`);
        return;
      }
      setPickedNames(new Set());
      setShowPicker(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(id: string) {
    const name = editName.trim();
    if (!name) return;
    setError(null);
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name };
      if (kind === 'division') body.default_score_type = editScoreType;
      const res = await fetch(itemPath(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = res.status === 204 ? null : await res.json();
      if (!res.ok) {
        setError(json?.detail || 'Failed to save');
        return;
      }
      setEditingId(null);
      setEditName('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(itemPath(id), { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const json = await res.json().catch(() => ({}));
        setError(json?.detail || 'Failed to delete');
        return;
      }
      setConfirmDeleteId(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function move(id: string, direction: 'up' | 'down') {
    const idx = items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= items.length) return;
    const a = items[idx];
    const b = items[swapIdx];
    setError(null);
    setBusy(true);
    try {
      const aOrder = a.sort_order ?? (idx + 1) * 10;
      const bOrder = b.sort_order ?? (swapIdx + 1) * 10;
      await Promise.all([
        fetch(itemPath(a.id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sort_order: bOrder }),
        }),
        fetch(itemPath(b.id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sort_order: aOrder }),
        }),
      ]);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const customPlaceholder =
    kind === 'ring'
      ? 'e.g. Ring 1'
      : kind === 'division'
        ? 'e.g. Western Pleasure'
        : 'e.g. 10 & Under';

  return (
    <section
      className="p-5 rounded-lg border"
      style={{ borderColor: '#d4b896', backgroundColor: '#fff' }}
    >
      <h2 className="text-base font-semibold mb-3" style={{ color: '#2c1810' }}>
        {title}
      </h2>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {items.length === 0 ? (
        <p className="text-sm mb-4" style={{ color: '#8b7355' }}>
          {emptyHint}
        </p>
      ) : (
        <ul className="space-y-1 mb-4">
          {items.map((item, idx) => (
            <li
              key={item.id}
              className="flex items-center justify-between text-sm py-1 gap-2 border-b"
              style={{ borderColor: '#f0e6d2' }}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="flex flex-col">
                  <button
                    type="button"
                    disabled={busy || idx === 0}
                    onClick={() => move(item.id, 'up')}
                    className="text-xs leading-none disabled:opacity-30"
                    style={{ color: '#8b7355' }}
                    title="Move up"
                    aria-label="Move up"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    disabled={busy || idx === items.length - 1}
                    onClick={() => move(item.id, 'down')}
                    className="text-xs leading-none disabled:opacity-30"
                    style={{ color: '#8b7355' }}
                    title="Move down"
                    aria-label="Move down"
                  >
                    ▼
                  </button>
                </div>
                {editingId === item.id ? (
                  <div className="flex-1 flex flex-col gap-1">
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && kind !== 'division') handleRename(item.id);
                        if (e.key === 'Escape') {
                          setEditingId(null);
                          setEditName('');
                        }
                      }}
                      className="border rounded px-2 py-1 text-sm"
                      style={{ borderColor: '#d4b896' }}
                    />
                    {kind === 'division' && (
                      <div className="flex flex-wrap gap-1 text-xs">
                        {SCORE_TYPE_OPTIONS.map((opt) => (
                          <label
                            key={opt.value}
                            className="flex items-center gap-1 cursor-pointer px-1.5 py-0.5 rounded"
                            style={{
                              background: editScoreType === opt.value ? '#fef3c7' : 'transparent',
                              color: '#5c3d1e',
                            }}
                            title={opt.hint}
                          >
                            <input
                              type="radio"
                              name={`edit-score-${item.id}`}
                              checked={editScoreType === opt.value}
                              onChange={() => setEditScoreType(opt.value)}
                            />
                            {opt.label}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <span style={{ color: '#2c1810' }}>{item.name}</span>
                    {kind === 'division' && item.default_score_type && (
                      <span
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{ color: '#7c5c2e', background: '#fef3c7' }}
                        title={`Default scoring: ${SCORE_TYPE_LABEL[item.default_score_type]}`}
                      >
                        {SCORE_TYPE_LABEL[item.default_score_type]}
                      </span>
                    )}
                    <span className="text-xs" style={{ color: '#8b7355' }}>
                      {item.class_count} class{item.class_count === 1 ? '' : 'es'}
                    </span>
                  </>
                )}
              </div>

              {editingId === item.id ? (
                <span className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleRename(item.id)}
                    disabled={busy}
                    className="text-xs disabled:opacity-50"
                    style={{ color: '#8b4513' }}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(null);
                      setEditName('');
                    }}
                    className="text-xs hover:underline"
                    style={{ color: '#8b7355' }}
                  >
                    Cancel
                  </button>
                </span>
              ) : confirmDeleteId === item.id ? (
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-xs" style={{ color: '#5c3d1e' }}>
                    Delete?
                  </span>
                  <button
                    onClick={() => handleDelete(item.id)}
                    disabled={busy}
                    className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                  >
                    {busy ? '…' : 'Yes'}
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    className="text-xs hover:underline"
                    style={{ color: '#8b7355' }}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <span className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => {
                      setEditingId(item.id);
                      setEditName(item.name);
                      setEditScoreType(item.default_score_type ?? 'placement');
                    }}
                    disabled={busy}
                    className="text-xs hover:underline disabled:opacity-50"
                    style={{ color: '#8b4513' }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(item.id)}
                    disabled={busy || item.class_count > 0}
                    title={
                      item.class_count > 0
                        ? `Reassign or remove the ${item.class_count} class${item.class_count === 1 ? '' : 'es'} using this ${kind} first`
                        : undefined
                    }
                    className="text-xs text-red-600 hover:underline disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Delete
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {!showCustomForm && !showPicker && (
        <div className="flex flex-wrap gap-3">
          {availableStandards.length > 0 && (
            <button
              onClick={() => setShowPicker(true)}
              className="text-sm hover:underline"
              style={{ color: '#8b4513' }}
            >
              + Add from standard list
            </button>
          )}
          <button
            onClick={() => setShowCustomForm(true)}
            className="text-sm hover:underline"
            style={{ color: '#8b4513' }}
          >
            + Add custom {kind}
          </button>
        </div>
      )}

      {showCustomForm && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              autoFocus
              placeholder={customPlaceholder}
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && kind !== 'division') handleSubmitCustom();
                if (e.key === 'Escape') {
                  setShowCustomForm(false);
                  setCustomName('');
                }
              }}
              className="flex-1 border rounded px-3 py-1 text-sm"
              style={{ borderColor: '#d4b896' }}
            />
            <button
              onClick={handleSubmitCustom}
              disabled={busy || !customName.trim()}
              className="px-3 py-1 rounded text-sm text-white disabled:opacity-50"
              style={{ backgroundColor: '#8b4513' }}
            >
              {busy ? 'Adding…' : 'Add'}
            </button>
            <button
              onClick={() => {
                setShowCustomForm(false);
                setCustomName('');
              }}
              className="px-3 py-1 rounded text-sm border"
              style={{ borderColor: '#d4b896', color: '#5a3e2b' }}
            >
              Cancel
            </button>
          </div>
          {kind === 'division' && (
            <div>
              <p className="text-xs mb-1" style={{ color: '#5c3d1e' }}>
                Scoring (how this discipline is judged)
              </p>
              <div className="flex flex-wrap gap-3 text-xs">
                {SCORE_TYPE_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex items-center gap-1 cursor-pointer"
                    style={{ color: '#5c3d1e' }}
                  >
                    <input
                      type="radio"
                      name="custom-score-type"
                      checked={customScoreType === opt.value}
                      onChange={() => setCustomScoreType(opt.value)}
                    />
                    <span className="font-medium">{opt.label}</span>
                    <span style={{ color: '#8b7355' }}>— {opt.hint}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {showPicker && (
        <div className="mt-3 border rounded p-3" style={{ borderColor: '#d4b896', backgroundColor: '#faf6ef' }}>
          <p className="text-xs mb-2" style={{ color: '#5a3e2b' }}>{pickerHint}</p>
          {availableStandards.length === 0 ? (
            <p className="text-sm" style={{ color: '#8b7355' }}>
              All standard {kind}s have been added.
            </p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-1 max-h-72 overflow-y-auto">
              {availableStandards.map((opt) => {
                const checked = pickedNames.has(opt.name);
                return (
                  <label
                    key={opt.id}
                    className="flex items-center gap-2 text-sm py-1 cursor-pointer"
                    style={{ color: '#2c1810' }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = new Set(pickedNames);
                        if (e.target.checked) next.add(opt.name);
                        else next.delete(opt.name);
                        setPickedNames(next);
                      }}
                    />
                    <span>{opt.name}</span>
                    {kind === 'division' && opt.default_score_type && (
                      <span
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{ color: '#7c5c2e', background: '#fef3c7' }}
                      >
                        {SCORE_TYPE_LABEL[opt.default_score_type]}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleAddPicked}
              disabled={busy || pickedNames.size === 0}
              className="px-3 py-1 rounded text-sm text-white disabled:opacity-50"
              style={{ backgroundColor: '#8b4513' }}
            >
              {busy ? 'Adding…' : `Add ${pickedNames.size || ''}`.trim()}
            </button>
            <button
              onClick={() => {
                setShowPicker(false);
                setPickedNames(new Set());
              }}
              className="px-3 py-1 rounded text-sm border"
              style={{ borderColor: '#d4b896', color: '#5a3e2b' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
