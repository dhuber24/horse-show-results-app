'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  COLORS,
  SCORING_LABEL,
  type ClassScoring,
  type Division,
  type DivisionScoring,
  type Futurity,
} from '../../futurity-shared';

type ClassRow = {
  class_id: string;
  selected: boolean;
  scoring: ClassScoring;
  group_name: string;
};

/** Rows for every class in the futurity, pre-set from an existing division. */
function rowsFor(futurity: Futurity, division: Division | null): ClassRow[] {
  const existing = new Map((division?.classes ?? []).map((c) => [c.class_id, c]));
  return futurity.classes.map((c) => {
    const found = existing.get(c.class_id);
    return {
      class_id: c.class_id,
      selected: Boolean(found),
      scoring: found?.scoring ?? 'counts',
      group_name: found?.group_name ?? '',
    };
  });
}

export default function HiPointEditor({
  showId,
  futurity,
}: {
  showId: string;
  futurity: Futurity;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  if (futurity.classes.length === 0) {
    return (
      <p className="text-sm" style={{ color: COLORS.muted }}>
        This futurity has no classes yet — add them in{' '}
        <Link
          href={`/admin/shows/${showId}/futurities/${futurity.id}/settings`}
          className="underline"
          style={{ color: COLORS.accent }}
        >
          Settings
        </Link>{' '}
        before setting up award divisions.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {!creating && editing === null && (
        <button
          onClick={() => setCreating(true)}
          className="px-4 py-2 rounded text-sm font-medium"
          style={{ backgroundColor: COLORS.text, color: '#f5ede0' }}
        >
          + Add a division
        </button>
      )}

      {creating && (
        <DivisionForm
          showId={showId}
          futurity={futurity}
          division={null}
          onDone={() => setCreating(false)}
        />
      )}

      {futurity.divisions.length === 0 && !creating ? (
        <p className="text-sm" style={{ color: COLORS.muted }}>
          No award divisions yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {futurity.divisions.map((division) =>
            editing === division.id ? (
              <li key={division.id}>
                <DivisionForm
                  showId={showId}
                  futurity={futurity}
                  division={division}
                  onDone={() => setEditing(null)}
                />
              </li>
            ) : (
              <li
                key={division.id}
                className="p-4 rounded-lg border"
                style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold" style={{ color: COLORS.text }}>
                      {division.name}
                    </h3>
                    <p className="text-xs" style={{ color: COLORS.muted }}>
                      {SCORING_LABEL[division.scoring_method]}
                    </p>
                  </div>
                  <button
                    onClick={() => setEditing(division.id)}
                    className="text-sm hover:underline"
                    style={{ color: COLORS.accent }}
                  >
                    Edit
                  </button>
                </div>
                <ul className="mt-2 text-sm space-y-1">
                  {division.classes.map((c) => (
                    <li key={c.class_id} style={{ color: COLORS.text }}>
                      <span className="font-mono text-xs">#{c.class_number}</span>{' '}
                      {c.class_name}
                      {c.scoring === 'best_of_group' && (
                        <span className="text-xs ml-1" style={{ color: COLORS.muted }}>
                          — best of “{c.group_name}”
                        </span>
                      )}
                    </li>
                  ))}
                  {division.classes.length === 0 && (
                    <li className="text-sm" style={{ color: COLORS.muted }}>
                      No classes count toward this division yet.
                    </li>
                  )}
                </ul>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function DivisionForm({
  showId,
  futurity,
  division,
  onDone,
}: {
  showId: string;
  futurity: Futurity;
  division: Division | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(division?.name ?? '');
  const [scoring, setScoring] = useState<DivisionScoring>(
    division?.scoring_method ?? 'sum_placings',
  );
  const [rows, setRows] = useState<ClassRow[]>(rowsFor(futurity, division));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const classById = new Map(futurity.classes.map((c) => [c.class_id, c]));

  function setRow(classId: string, patch: Partial<ClassRow>) {
    setRows((prev) =>
      prev.map((r) => (r.class_id === classId ? { ...r, ...patch } : r)),
    );
  }

  async function save() {
    setError(null);
    if (name.trim() === '') {
      setError('Give the division a name.');
      return;
    }
    const picked = rows.filter((r) => r.selected);
    const missingGroup = picked.find(
      (r) => r.scoring === 'best_of_group' && r.group_name.trim() === '',
    );
    if (missingGroup) {
      const cls = classById.get(missingGroup.class_id);
      setError(
        `#${cls?.class_number} is set to "best of group" but has no group name — the name is what ties the competing classes together.`,
      );
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        scoring_method: scoring,
        sort_order: division?.sort_order ?? futurity.divisions.length,
        classes: picked.map((r) => ({
          class_id: r.class_id,
          scoring: r.scoring,
          group_name: r.scoring === 'best_of_group' ? r.group_name.trim() : null,
        })),
      };
      const url = division
        ? `/api/shows/${showId}/futurities/${futurity.id}/divisions/${division.id}`
        : `/api/shows/${showId}/futurities/${futurity.id}/divisions`;
      const res = await fetch(url, {
        method: division ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.detail || 'Failed to save the division.');
        return;
      }
      router.refresh();
      onDone();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!division) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/shows/${showId}/futurities/${futurity.id}/divisions/${division.id}`,
        { method: 'DELETE' },
      );
      if (!res.ok && res.status !== 204) {
        const j = await res.json().catch(() => null);
        setError(j?.detail || 'Failed to delete the division.');
        return;
      }
      router.refresh();
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="p-4 rounded-lg border space-y-4"
      style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
    >
      <h3 className="font-semibold" style={{ color: COLORS.text }}>
        {division ? `Edit ${division.name}` : 'New division'}
      </h3>

      {error && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#c0392b', backgroundColor: '#fef0ef', color: '#922' }}
        >
          {error}
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
            Name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Yearling"
            className="w-full border rounded px-3 py-2 text-sm"
            style={{ borderColor: COLORS.border }}
          />
        </label>
        <label className="block">
          <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
            Scoring
          </span>
          <select
            value={scoring}
            onChange={(e) => setScoring(e.target.value as DivisionScoring)}
            className="w-full border rounded px-3 py-2 text-sm"
            style={{ borderColor: COLORS.border }}
          >
            {(Object.keys(SCORING_LABEL) as DivisionScoring[]).map((key) => (
              <option key={key} value={key}>
                {SCORING_LABEL[key]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-2">
        <span className="block text-xs" style={{ color: COLORS.muted }}>
          Which classes count
        </span>
        <div
          className="max-h-96 overflow-y-auto border rounded p-2 space-y-2"
          style={{ borderColor: COLORS.border }}
        >
          {rows.map((row) => {
            const cls = classById.get(row.class_id);
            if (!cls) return null;
            return (
              <div key={row.class_id} className="space-y-1">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={row.selected}
                    onChange={(e) => setRow(row.class_id, { selected: e.target.checked })}
                  />
                  <span className="font-mono text-xs">#{cls.class_number}</span>
                  <span style={{ color: COLORS.text }}>{cls.class_name}</span>
                </label>
                {row.selected && (
                  <div className="ml-6 flex flex-wrap items-center gap-2">
                    <select
                      value={row.scoring}
                      onChange={(e) =>
                        setRow(row.class_id, {
                          scoring: e.target.value as ClassScoring,
                          group_name:
                            e.target.value === 'counts' ? '' : row.group_name,
                        })
                      }
                      className="border rounded px-2 py-1 text-xs"
                      style={{ borderColor: COLORS.border }}
                    >
                      <option value="counts">Always counts</option>
                      <option value="best_of_group">Best of a group</option>
                    </select>
                    {row.scoring === 'best_of_group' && (
                      <input
                        value={row.group_name}
                        onChange={(e) =>
                          setRow(row.class_id, { group_name: e.target.value })
                        }
                        placeholder="group name, e.g. Pleasure"
                        className="border rounded px-2 py-1 text-xs"
                        style={{ borderColor: COLORS.border }}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-xs" style={{ color: COLORS.muted }}>
          Classes sharing a group name contribute one result between them — the
          best. Give every class in the same bucket the same name.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={save}
          disabled={busy}
          className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: COLORS.text, color: '#f5ede0' }}
        >
          {busy ? 'Saving…' : 'Save division'}
        </button>
        <button
          onClick={onDone}
          disabled={busy}
          className="px-4 py-2 rounded text-sm border disabled:opacity-50"
          style={{ borderColor: COLORS.border, color: COLORS.text }}
        >
          Cancel
        </button>
        {division &&
          (confirmingDelete ? (
            <span className="flex items-center gap-2 ml-auto">
              <span className="text-xs" style={{ color: '#5c3d1e' }}>
                Delete {division.name}?
              </span>
              <button
                onClick={remove}
                disabled={busy}
                className="text-xs text-red-600 hover:underline disabled:opacity-50"
              >
                Yes, delete
              </button>
              <button
                onClick={() => setConfirmingDelete(false)}
                disabled={busy}
                className="text-xs hover:underline"
                style={{ color: COLORS.muted }}
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmingDelete(true)}
              className="text-sm text-red-600 hover:text-red-800 ml-auto"
            >
              Delete division
            </button>
          ))}
      </div>
    </div>
  );
}
