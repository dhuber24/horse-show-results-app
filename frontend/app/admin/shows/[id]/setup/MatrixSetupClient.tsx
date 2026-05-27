'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type ScoreType = 'placement' | 'pattern' | 'time';

export type RingItem = {
  id: string;
  show_id: string;
  name: string;
  sort_order: number | null;
};

type CatalogDivision = {
  id: string;
  name: string;
  sort_order: number;
  default_score_type: ScoreType;
};

type CatalogSection = {
  id: string;
  name: string;
  sort_order: number;
};

type CatalogClass = {
  id: string;
  standard_division_id: string;
  standard_section_id: string;
  class_code: string | null;
  class_name: string;
  default_score_type: ScoreType;
  sort_order: number;
};

type CatalogCell = {
  standard_division_id: string;
  standard_section_id: string;
  classes: CatalogClass[];
};

export type CatalogPayload = {
  show_type_id: string;
  show_type_code: string;
  divisions: CatalogDivision[];
  sections: CatalogSection[];
  cells: CatalogCell[];
};

type Props = {
  showId: string;
  showTypeCode: string | null;
  showName: string;
  existingRings: RingItem[];
  standardRingNames: string[];
  catalog: CatalogPayload | null;
};

const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  border: '#d4b896',
  borderSoft: '#f0e6d2',
  bg: '#fff',
  highlight: '#fef3c7',
  highlightStrong: '#fde68a',
  warn: '#5c3d1e',
} as const;

function cellKey(divId: string, secId: string): string {
  return `${divId}::${secId}`;
}

export default function MatrixSetupClient({
  showId,
  showTypeCode,
  showName,
  existingRings,
  standardRingNames,
  catalog,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Local ring state for additions before commit. Existing rings get committed
  // through the existing per-ring API (kept), new ones are committed via apply.
  const [newRingNames, setNewRingNames] = useState<string[]>([]);
  const [newRingDraft, setNewRingDraft] = useState('');
  const [showRingPicker, setShowRingPicker] = useState(false);
  const [pickedStandardRings, setPickedStandardRings] = useState<Set<string>>(new Set());

  // Matrix selection: cell-level checkbox = "include all classes in this cell".
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  // Per-class opt-outs within a selected cell (defaults to "all selected").
  const [excludedClassIds, setExcludedClassIds] = useState<Set<string>>(new Set());
  // Which cell's detail panel is currently expanded (null = none).
  const [expandedCell, setExpandedCell] = useState<string | null>(null);

  const cellsByKey = useMemo(() => {
    const m = new Map<string, CatalogCell>();
    if (catalog) {
      for (const cell of catalog.cells) {
        m.set(cellKey(cell.standard_division_id, cell.standard_section_id), cell);
      }
    }
    return m;
  }, [catalog]);

  const existingRingNames = useMemo(
    () => new Set(existingRings.map((r) => r.name.toLowerCase())),
    [existingRings],
  );

  const availableStandardRings = standardRingNames.filter(
    (n) =>
      !existingRingNames.has(n.toLowerCase()) &&
      !newRingNames.some((nn) => nn.toLowerCase() === n.toLowerCase()),
  );

  function toggleCell(divId: string, secId: string) {
    const key = cellKey(divId, secId);
    setSelectedCells((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        // Clear per-class exclusions for this cell when deselecting.
        const cell = cellsByKey.get(key);
        if (cell) {
          setExcludedClassIds((ex) => {
            const ne = new Set(ex);
            for (const c of cell.classes) ne.delete(c.id);
            return ne;
          });
        }
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function toggleClassExclusion(classId: string) {
    setExcludedClassIds((prev) => {
      const next = new Set(prev);
      if (next.has(classId)) next.delete(classId);
      else next.add(classId);
      return next;
    });
  }

  function addRingDraft() {
    const name = newRingDraft.trim();
    if (!name) return;
    if (
      existingRingNames.has(name.toLowerCase()) ||
      newRingNames.some((n) => n.toLowerCase() === name.toLowerCase())
    ) {
      setNewRingDraft('');
      return;
    }
    setNewRingNames((prev) => [...prev, name]);
    setNewRingDraft('');
  }

  function removeNewRing(name: string) {
    setNewRingNames((prev) => prev.filter((n) => n !== name));
  }

  function addPickedStandardRings() {
    if (pickedStandardRings.size === 0) {
      setShowRingPicker(false);
      return;
    }
    setNewRingNames((prev) => [...prev, ...Array.from(pickedStandardRings)]);
    setPickedStandardRings(new Set());
    setShowRingPicker(false);
  }

  // Count classes the user actually wants to create (selected cells minus exclusions).
  const totals = useMemo(() => {
    let classCount = 0;
    const divs = new Set<string>();
    const secs = new Set<string>();
    for (const key of selectedCells) {
      const cell = cellsByKey.get(key);
      if (!cell) continue;
      divs.add(cell.standard_division_id);
      secs.add(cell.standard_section_id);
      for (const c of cell.classes) {
        if (!excludedClassIds.has(c.id)) classCount++;
      }
    }
    return {
      classCount,
      divisionCount: divs.size,
      sectionCount: secs.size,
      cellCount: selectedCells.size,
      ringCount: newRingNames.length,
    };
  }, [selectedCells, excludedClassIds, cellsByKey, newRingNames]);

  async function handleApply() {
    if (totals.classCount === 0 && totals.cellCount === 0 && totals.ringCount === 0) return;
    setError(null);
    setSuccessMsg(null);
    setBusy(true);
    try {
      const picks: { standard_class_id?: string; standard_division_id?: string; standard_section_id?: string }[] = [];
      for (const key of selectedCells) {
        const cell = cellsByKey.get(key);
        if (!cell) continue;
        const includedClasses = cell.classes.filter((c) => !excludedClassIds.has(c.id));
        if (includedClasses.length === 0) {
          // Cell selected but every class excluded — still create the (div, sec) pair.
          picks.push({
            standard_division_id: cell.standard_division_id,
            standard_section_id: cell.standard_section_id,
          });
        } else {
          for (const c of includedClasses) {
            picks.push({ standard_class_id: c.id });
          }
        }
      }
      const rings = newRingNames.map((name) => ({ name }));
      const res = await fetch(`/api/shows/${showId}/setup/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rings, picks }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.detail || 'Failed to apply setup picks');
        return;
      }
      const created = json as {
        created_ring_ids: string[];
        created_division_ids: string[];
        created_section_ids: string[];
        created_class_ids: string[];
      };
      const parts: string[] = [];
      if (created.created_ring_ids.length) parts.push(`${created.created_ring_ids.length} rings`);
      if (created.created_division_ids.length) parts.push(`${created.created_division_ids.length} divisions`);
      if (created.created_section_ids.length) parts.push(`${created.created_section_ids.length} sections`);
      if (created.created_class_ids.length) parts.push(`${created.created_class_ids.length} classes`);
      setSuccessMsg(parts.length ? `Created ${parts.join(', ')}.` : 'Nothing new to create — picks were already applied.');
      setSelectedCells(new Set());
      setExcludedClassIds(new Set());
      setNewRingNames([]);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function deleteExistingRing(ringId: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/shows/${showId}/rings/${ringId}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        const json = await res.json().catch(() => null);
        setError(json?.detail || 'Failed to delete ring');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#c0392b', backgroundColor: '#fef0ef', color: '#922' }}
          role="alert"
        >
          {error}
        </div>
      )}
      {successMsg && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#7fa97f', backgroundColor: '#eef7ee', color: '#1f4e1f' }}
        >
          {successMsg}
        </div>
      )}

      {/* ── Rings panel ──────────────────────────────────────────────────── */}
      <section
        className="p-4 rounded-lg border"
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
            Rings
          </h2>
          <span className="text-xs" style={{ color: COLORS.muted }}>
            {existingRings.length} configured
            {newRingNames.length > 0 ? ` · ${newRingNames.length} pending apply` : ''}
          </span>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          {existingRings.map((r) => (
            <span
              key={r.id}
              className="inline-flex items-center gap-1.5 text-sm rounded px-2 py-1 border"
              style={{ borderColor: COLORS.border, backgroundColor: '#fff8e1', color: COLORS.text }}
            >
              {r.name}
              <button
                type="button"
                disabled={busy}
                onClick={() => deleteExistingRing(r.id)}
                aria-label={`Remove ring ${r.name}`}
                title="Remove ring"
                className="text-xs leading-none ml-1 hover:text-red-700 disabled:opacity-50"
                style={{ color: COLORS.muted }}
              >
                ×
              </button>
            </span>
          ))}
          {newRingNames.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1.5 text-sm rounded px-2 py-1 border border-dashed"
              style={{ borderColor: '#bca15f', backgroundColor: '#fef3c7', color: COLORS.warn }}
              title="Will be created on Apply"
            >
              {name}
              <button
                type="button"
                onClick={() => removeNewRing(name)}
                aria-label={`Remove pending ring ${name}`}
                title="Remove"
                className="text-xs leading-none ml-1 hover:text-red-700"
                style={{ color: COLORS.muted }}
              >
                ×
              </button>
            </span>
          ))}
          <input
            type="text"
            placeholder="Add custom ring…"
            value={newRingDraft}
            onChange={(e) => setNewRingDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addRingDraft();
              }
            }}
            className="text-sm border rounded px-2 py-1"
            style={{ borderColor: COLORS.border, minWidth: '12rem' }}
          />
          {availableStandardRings.length > 0 && (
            <button
              type="button"
              onClick={() => setShowRingPicker((s) => !s)}
              className="text-sm rounded px-2 py-1 border"
              style={{ borderColor: COLORS.border, color: COLORS.warn, backgroundColor: '#fff' }}
            >
              + Standard
            </button>
          )}
        </div>

        {showRingPicker && availableStandardRings.length > 0 && (
          <div
            className="mt-3 rounded border p-3"
            style={{ borderColor: COLORS.borderSoft, backgroundColor: '#fdf8eb' }}
          >
            <div className="flex flex-wrap gap-x-3 gap-y-1.5 mb-2">
              {availableStandardRings.map((name) => (
                <label key={name} className="text-sm flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={pickedStandardRings.has(name)}
                    onChange={() =>
                      setPickedStandardRings((prev) => {
                        const next = new Set(prev);
                        if (next.has(name)) next.delete(name);
                        else next.add(name);
                        return next;
                      })
                    }
                  />
                  {name}
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={addPickedStandardRings}
                disabled={pickedStandardRings.size === 0}
                className="text-sm rounded px-3 py-1 disabled:opacity-50"
                style={{ backgroundColor: COLORS.warn, color: '#fff' }}
              >
                Add {pickedStandardRings.size > 0 ? `(${pickedStandardRings.size})` : ''}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowRingPicker(false);
                  setPickedStandardRings(new Set());
                }}
                className="text-sm rounded px-3 py-1 border"
                style={{ borderColor: COLORS.border, color: COLORS.text }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Standard Library matrix ──────────────────────────────────────── */}
      <section
        className="p-4 rounded-lg border"
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
      >
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
            Standard Library{showTypeCode ? ` — ${showTypeCode}` : ''}
          </h2>
          <span className="text-xs" style={{ color: COLORS.muted }}>
            Click a cell to include all its classes; click again to drop them. The cell
            count is the number of standard classes available.
          </span>
        </div>

        {!catalog ||
        catalog.divisions.length === 0 ||
        catalog.sections.length === 0 ? (
          <p className="text-sm" style={{ color: COLORS.muted }}>
            No standard library is seeded for {showTypeCode ?? 'this show type'} yet.
            Add divisions, sections, and classes manually from their pages, or contact
            an admin to seed a library.
          </p>
        ) : (
          <MatrixGrid
            catalog={catalog}
            cellsByKey={cellsByKey}
            selectedCells={selectedCells}
            excludedClassIds={excludedClassIds}
            expandedCell={expandedCell}
            onToggleCell={toggleCell}
            onSetExpanded={setExpandedCell}
            onToggleClassExclusion={toggleClassExclusion}
          />
        )}
      </section>

      {/* ── Apply bar ────────────────────────────────────────────────────── */}
      <section
        className="p-4 rounded-lg border flex items-center justify-between gap-4 flex-wrap"
        style={{ borderColor: COLORS.border, backgroundColor: '#fdf8eb' }}
      >
        <div className="text-sm" style={{ color: COLORS.text }}>
          <strong>{totals.classCount}</strong> classes
          {' · '}
          <strong>{totals.divisionCount}</strong> divisions
          {' · '}
          <strong>{totals.sectionCount}</strong> sections
          {totals.ringCount > 0 && (
            <>
              {' · '}
              <strong>{totals.ringCount}</strong> new rings
            </>
          )}{' '}
          selected for {showName}.
        </div>
        <button
          type="button"
          disabled={
            busy || (totals.classCount === 0 && totals.cellCount === 0 && totals.ringCount === 0)
          }
          onClick={handleApply}
          className="text-sm rounded px-4 py-2 disabled:opacity-50"
          style={{ backgroundColor: COLORS.warn, color: '#fff' }}
        >
          {busy ? 'Applying…' : 'Apply picks'}
        </button>
      </section>
    </div>
  );
}

type MatrixGridProps = {
  catalog: CatalogPayload;
  cellsByKey: Map<string, CatalogCell>;
  selectedCells: Set<string>;
  excludedClassIds: Set<string>;
  expandedCell: string | null;
  onToggleCell: (divId: string, secId: string) => void;
  onSetExpanded: (key: string | null) => void;
  onToggleClassExclusion: (classId: string) => void;
};

function MatrixGrid({
  catalog,
  cellsByKey,
  selectedCells,
  excludedClassIds,
  expandedCell,
  onToggleCell,
  onSetExpanded,
  onToggleClassExclusion,
}: MatrixGridProps) {
  const expandedCellDetail = expandedCell ? cellsByKey.get(expandedCell) ?? null : null;
  const expandedCellLabels = (() => {
    if (!expandedCellDetail) return null;
    const div = catalog.divisions.find(
      (d) => d.id === expandedCellDetail.standard_division_id,
    );
    const sec = catalog.sections.find(
      (s) => s.id === expandedCellDetail.standard_section_id,
    );
    return div && sec ? { divName: div.name, secName: sec.name } : null;
  })();

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              <th
                className="sticky left-0 z-10 text-left font-semibold pr-3 pb-2 border-b"
                style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg, color: COLORS.text }}
              >
                Discipline
              </th>
              {catalog.sections.map((s) => (
                <th
                  key={s.id}
                  className="font-medium text-xs px-2 pb-2 border-b text-center"
                  style={{ borderColor: COLORS.border, color: COLORS.warn, minWidth: '4.5rem' }}
                  title={s.name}
                >
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {catalog.divisions.map((d) => (
              <tr key={d.id}>
                <th
                  className="sticky left-0 z-10 text-left font-normal pr-3 py-1.5 border-b"
                  style={{
                    borderColor: COLORS.borderSoft,
                    backgroundColor: COLORS.bg,
                    color: COLORS.text,
                  }}
                  scope="row"
                  title={`Score type: ${d.default_score_type}`}
                >
                  {d.name}
                </th>
                {catalog.sections.map((s) => {
                  const key = cellKey(d.id, s.id);
                  const cell = cellsByKey.get(key);
                  const count = cell?.classes.length ?? 0;
                  const isSelected = selectedCells.has(key);
                  const isExpanded = expandedCell === key;
                  if (count === 0) {
                    return (
                      <td
                        key={s.id}
                        className="text-center px-2 py-1.5 border-b text-xs"
                        style={{ borderColor: COLORS.borderSoft, color: '#c8b896' }}
                      >
                        —
                      </td>
                    );
                  }
                  const excludedHere = cell
                    ? cell.classes.filter((c) => excludedClassIds.has(c.id)).length
                    : 0;
                  const includedHere = count - excludedHere;
                  return (
                    <td
                      key={s.id}
                      className="text-center border-b p-0"
                      style={{ borderColor: COLORS.borderSoft }}
                    >
                      <div className="relative flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => onToggleCell(d.id, s.id)}
                          className="text-xs font-medium rounded px-2 py-1 hover:bg-amber-50"
                          style={{
                            backgroundColor: isSelected
                              ? isExpanded
                                ? COLORS.highlightStrong
                                : COLORS.highlight
                              : 'transparent',
                            color: isSelected ? COLORS.warn : COLORS.text,
                            border: isSelected
                              ? `1px solid ${COLORS.warn}`
                              : '1px solid transparent',
                            minWidth: '3.25rem',
                          }}
                          title={
                            isSelected
                              ? `${includedHere} of ${count} classes selected — click to deselect`
                              : `${count} classes available — click to include`
                          }
                        >
                          {isSelected
                            ? excludedHere > 0
                              ? `${includedHere}/${count}`
                              : `✓ ${count}`
                            : count}
                        </button>
                        {isSelected && (
                          <button
                            type="button"
                            onClick={() => onSetExpanded(isExpanded ? null : key)}
                            className="text-xs leading-none"
                            style={{ color: COLORS.muted }}
                            title={isExpanded ? 'Hide classes' : 'Pick which classes'}
                            aria-label="Customize classes"
                          >
                            {isExpanded ? '▴' : '▾'}
                          </button>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {expandedCellDetail && expandedCellLabels && (
        <div
          className="rounded border p-3"
          style={{ borderColor: COLORS.border, backgroundColor: '#fdf8eb' }}
        >
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-sm font-medium" style={{ color: COLORS.text }}>
              {expandedCellLabels.divName} × {expandedCellLabels.secName}
            </p>
            <button
              type="button"
              onClick={() => onSetExpanded(null)}
              className="text-xs"
              style={{ color: COLORS.muted }}
            >
              Close
            </button>
          </div>
          <p className="text-xs mb-2" style={{ color: COLORS.muted }}>
            Uncheck classes you don&apos;t want to create. All checked by default.
          </p>
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
            {expandedCellDetail.classes.map((c) => {
              const excluded = excludedClassIds.has(c.id);
              return (
                <label key={c.id} className="text-xs flex items-start gap-1.5">
                  <input
                    type="checkbox"
                    checked={!excluded}
                    onChange={() => onToggleClassExclusion(c.id)}
                    className="mt-0.5"
                  />
                  <span style={{ color: excluded ? COLORS.muted : COLORS.text }}>
                    {c.class_code && (
                      <span style={{ color: COLORS.muted }}>{c.class_code} · </span>
                    )}
                    {c.class_name}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
