'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { getShowDates } from './showDateUtils';

interface Ring { id: string; name: string; }
type ScoreType = 'placement' | 'pattern' | 'time';
interface Division { id: string; name: string; default_score_type: ScoreType; }
interface Section { id: string; name: string; }

// Sentinel section id for the "(no section)" column. The builder swaps this
// for an empty section_ids list when calling the backend so the class is
// created with no section attached.
const NO_SECTION = '__none__';

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

export default function ScheduleBuilder({
  showId,
  showStartDate,
  showEndDate,
  rings,
  divisions: initialDivisions,
  sections: initialSections,
}: {
  showId: string;
  showStartDate: string;
  showEndDate: string;
  rings: Ring[];
  divisions: Division[];
  sections: Section[];
}) {
  const router = useRouter();
  const showDates = useMemo(() => getShowDates(showStartDate, showEndDate), [showStartDate, showEndDate]);

  const [open, setOpen] = useState(false);
  const [divisions, setDivisions] = useState<Division[]>(initialDivisions);
  const [sections, setSections] = useState<Section[]>(initialSections);

  const [classDate, setClassDate] = useState(showStartDate);
  const [ringId, setRingId] = useState<string>('');

  // checks: Map<divisionId, Set<sectionId | NO_SECTION>>
  const [checks, setChecks] = useState<Record<string, Set<string>>>({});

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);

  // Custom division add
  const [showAddDivision, setShowAddDivision] = useState(false);
  const [newDivisionName, setNewDivisionName] = useState('');
  const [newDivisionScore, setNewDivisionScore] = useState<ScoreType>('placement');
  const [divisionAdding, setDivisionAdding] = useState(false);
  const [divisionError, setDivisionError] = useState<string | null>(null);

  // Custom section add
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [sectionAdding, setSectionAdding] = useState(false);
  const [sectionError, setSectionError] = useState<string | null>(null);

  // Columns: every show section, plus a "(no section)" column at the end.
  const columns = useMemo(
    () => [...sections, { id: NO_SECTION, name: '(no section)' }],
    [sections],
  );

  const totalSelected = useMemo(
    () => Object.values(checks).reduce((n, s) => n + s.size, 0),
    [checks],
  );

  const toggleCell = (divisionId: string, sectionId: string) => {
    setChecks((prev) => {
      const next = { ...prev };
      const row = new Set(next[divisionId] ?? []);
      if (row.has(sectionId)) row.delete(sectionId);
      else row.add(sectionId);
      if (row.size === 0) delete next[divisionId];
      else next[divisionId] = row;
      return next;
    });
  };

  const toggleRow = (divisionId: string) => {
    setChecks((prev) => {
      const next = { ...prev };
      const row = next[divisionId] ?? new Set<string>();
      const allColIds = columns.map((c) => c.id);
      const allSelected = allColIds.every((cid) => row.has(cid));
      if (allSelected) {
        delete next[divisionId];
      } else {
        next[divisionId] = new Set(allColIds);
      }
      return next;
    });
  };

  const toggleColumn = (sectionId: string) => {
    setChecks((prev) => {
      const next: Record<string, Set<string>> = {};
      const allSelected = divisions.every((d) => prev[d.id]?.has(sectionId));
      for (const d of divisions) {
        const row = new Set(prev[d.id] ?? []);
        if (allSelected) row.delete(sectionId);
        else row.add(sectionId);
        if (row.size > 0) next[d.id] = row;
      }
      return next;
    });
  };

  const clearAll = () => setChecks({});

  const handleAddDivision = async () => {
    const name = newDivisionName.trim();
    if (!name) {
      setDivisionError('Division name is required.');
      return;
    }
    setDivisionAdding(true);
    setDivisionError(null);
    const res = await fetch(`/api/shows/${showId}/divisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, default_score_type: newDivisionScore }),
    });
    setDivisionAdding(false);
    if (res.ok) {
      const created: Division = await res.json();
      setDivisions((prev) => [...prev, created]);
      setNewDivisionName('');
      setNewDivisionScore('placement');
      setShowAddDivision(false);
    } else {
      const err = await res.json().catch(() => ({}));
      setDivisionError(err.detail ?? 'Failed to add division.');
    }
  };

  const handleAddSection = async () => {
    const name = newSectionName.trim();
    if (!name) {
      setSectionError('Section name is required.');
      return;
    }
    setSectionAdding(true);
    setSectionError(null);
    const res = await fetch(`/api/shows/${showId}/sections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    setSectionAdding(false);
    if (res.ok) {
      const created: Section = await res.json();
      setSections((prev) => [...prev, created]);
      setNewSectionName('');
      setShowAddSection(false);
    } else {
      const err = await res.json().catch(() => ({}));
      setSectionError(err.detail ?? 'Failed to add section.');
    }
  };

  const handleBuild = async () => {
    if (totalSelected === 0) return;
    setSaving(true);
    setError(null);
    setSuccessCount(null);

    const picks = Object.entries(checks)
      .map(([divisionId, secSet]) => {
        const sectionIds = Array.from(secSet).filter((s) => s !== NO_SECTION);
        const wantsNoSection = secSet.has(NO_SECTION);
        const items: { division_id: string; section_ids: string[] }[] = [];
        if (sectionIds.length > 0) {
          items.push({ division_id: divisionId, section_ids: sectionIds });
        }
        if (wantsNoSection) {
          items.push({ division_id: divisionId, section_ids: [] });
        }
        return items;
      })
      .flat();

    const res = await fetch(`/api/shows/${showId}/schedule-builder/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        class_date: classDate,
        ring_id: ringId || null,
        picks,
      }),
    });
    setSaving(false);
    if (res.ok) {
      const data = await res.json();
      setSuccessCount(Array.isArray(data) ? data.length : totalSelected);
      setChecks({});
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to build schedule.');
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm px-4 py-2 rounded border font-medium hover:bg-amber-50"
        style={{ borderColor: '#c9a96e', color: '#7c5c2e' }}
      >
        + Build Schedule
      </button>
    );
  }

  const showDivisionEmptyHint = divisions.length === 0;

  return (
    <div className="border rounded-lg p-4 space-y-4" style={{ borderColor: '#c9a96e', background: '#fffdf8' }}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold" style={{ color: '#2c1810' }}>Build Schedule</h3>
          <p className="text-xs mt-0.5" style={{ color: '#8b7355' }}>
            Check the divisions × sections cells you want. Each checked cell creates one numbered class.
            Class names are auto-built as &ldquo;{'{Section}'} {'{Division}'}&rdquo;.
          </p>
        </div>
        <button onClick={() => setOpen(false)} className="text-sm" style={{ color: '#8b7355' }}>
          Close
        </button>
      </div>

      {/* Date + ring controls */}
      <div className="flex gap-4 flex-wrap items-end">
        <div>
          <label className="block text-xs mb-1" style={{ color: '#8b7355' }}>Class date *</label>
          <select
            value={classDate}
            onChange={(e) => setClassDate(e.target.value)}
            className="border rounded px-3 py-1.5 text-sm"
          >
            {showDates.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>
        {rings.length > 0 && (
          <div>
            <label className="block text-xs mb-1" style={{ color: '#8b7355' }}>Ring</label>
            <select
              value={ringId}
              onChange={(e) => setRingId(e.target.value)}
              className="border rounded px-3 py-1.5 text-sm"
            >
              <option value="">No ring</option>
              {rings.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {showDivisionEmptyHint && (
        <p className="text-xs px-3 py-2 rounded" style={{ color: '#7c5c2e', background: '#fef3c7' }}>
          No divisions yet. Add a discipline below or in <span className="font-medium">Setup → Divisions</span>, then check cells.
        </p>
      )}

      {/* Matrix */}
      <div className="border rounded overflow-x-auto" style={{ maxHeight: '420px', overflowY: 'auto' }}>
        <table className="text-sm" style={{ minWidth: '100%' }}>
          <thead className="sticky top-0 bg-white border-b">
            <tr>
              <th className="px-2 py-2 text-left font-medium" style={{ color: '#5c3d1e' }}>
                Division
              </th>
              <th className="px-2 py-2 text-center font-medium w-10" title="Toggle whole row" style={{ color: '#5c3d1e' }}>
                All
              </th>
              {columns.map((c) => {
                const allColSelected = divisions.length > 0 && divisions.every((d) => checks[d.id]?.has(c.id));
                return (
                  <th key={c.id} className="px-2 py-2 text-left font-medium whitespace-nowrap" style={{ color: '#5c3d1e' }}>
                    <button
                      type="button"
                      onClick={() => toggleColumn(c.id)}
                      className="hover:underline"
                      title={`Toggle all rows for ${c.name}`}
                    >
                      <span className={allColSelected ? 'font-bold' : ''}>{c.name}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {divisions.map((d, i) => {
              const row = checks[d.id] ?? new Set<string>();
              const allRowSelected = columns.every((c) => row.has(c.id));
              return (
                <tr key={d.id} style={{ background: i % 2 === 0 ? '#fff' : '#fafaf8' }}>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span style={{ color: '#2c1810' }}>{d.name}</span>
                      <span
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{ color: '#7c5c2e', background: '#fef3c7' }}
                        title={`Scoring: ${SCORE_TYPE_LABEL[d.default_score_type]}`}
                      >
                        {SCORE_TYPE_LABEL[d.default_score_type]}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      checked={allRowSelected}
                      onChange={() => toggleRow(d.id)}
                      title={allRowSelected ? 'Clear this row' : 'Select all in this row'}
                    />
                  </td>
                  {columns.map((c) => (
                    <td key={c.id} className="px-2 py-1.5 text-center" onClick={() => toggleCell(d.id, c.id)} style={{ cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={row.has(c.id)}
                        onChange={() => toggleCell(d.id, c.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Custom division + section add */}
      <div className="space-y-3">
        {!showAddDivision ? (
          <button
            type="button"
            onClick={() => setShowAddDivision(true)}
            className="text-xs hover:underline"
            style={{ color: '#7c5c2e' }}
          >
            + Add custom division
          </button>
        ) : (
          <div className="p-3 rounded space-y-2" style={{ background: '#f7efe1' }}>
            <p className="text-sm font-semibold" style={{ color: '#2c1810' }}>
              Add custom division
            </p>
            <input
              autoFocus
              placeholder="Discipline name (e.g. Western Pleasure)"
              value={newDivisionName}
              onChange={(e) => setNewDivisionName(e.target.value)}
              className="w-full border rounded px-2 py-1 text-sm"
            />
            <div>
              <p className="text-xs mb-1" style={{ color: '#5c3d1e' }}>
                Scoring — how is this discipline judged?
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
                      name="new-division-score"
                      checked={newDivisionScore === opt.value}
                      onChange={() => setNewDivisionScore(opt.value)}
                    />
                    <span className="font-medium">{opt.label}</span>
                    <span style={{ color: '#8b7355' }}>— {opt.hint}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2 items-center">
              <button
                onClick={handleAddDivision}
                disabled={divisionAdding}
                className="px-3 py-1 rounded text-white text-sm disabled:opacity-50"
                style={{ background: '#7c5c2e' }}
              >
                {divisionAdding ? 'Adding…' : 'Add'}
              </button>
              <button
                onClick={() => { setShowAddDivision(false); setDivisionError(null); }}
                className="text-sm text-gray-500"
              >
                Cancel
              </button>
              {divisionError && <span className="text-xs text-red-600">{divisionError}</span>}
            </div>
          </div>
        )}

        {!showAddSection ? (
          <button
            type="button"
            onClick={() => setShowAddSection(true)}
            className="text-xs hover:underline"
            style={{ color: '#7c5c2e' }}
          >
            + Add custom section
          </button>
        ) : (
          <div className="flex gap-2 flex-wrap items-end p-2 rounded" style={{ background: '#f7efe1' }}>
            <input
              autoFocus
              placeholder="Section name (e.g. 10 & Under)"
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            />
            <button
              onClick={handleAddSection}
              disabled={sectionAdding}
              className="px-3 py-1 rounded text-white text-sm disabled:opacity-50"
              style={{ background: '#7c5c2e' }}
            >
              {sectionAdding ? 'Adding…' : 'Add'}
            </button>
            <button
              onClick={() => { setShowAddSection(false); setSectionError(null); }}
              className="text-sm text-gray-500"
            >
              Cancel
            </button>
            {sectionError && <span className="text-xs text-red-600 w-full">{sectionError}</span>}
          </div>
        )}
      </div>

      <p className="text-xs" style={{ color: '#8b7355' }}>
        Class numbers continue from the show&apos;s current schedule. Scoring is set from each division&apos;s default.
      </p>

      <div className="flex gap-2 items-center">
        <button
          onClick={handleBuild}
          disabled={saving || totalSelected === 0}
          title={totalSelected === 0 ? 'Check at least one cell' : undefined}
          className="px-5 py-2 rounded text-white font-medium disabled:opacity-50"
          style={{ background: totalSelected === 0 ? '#9ca3af' : '#7c5c2e' }}
        >
          {saving
            ? 'Building…'
            : totalSelected === 0
              ? 'Build'
              : `Build ${totalSelected} Class${totalSelected !== 1 ? 'es' : ''}`}
        </button>
        {totalSelected > 0 && (
          <button onClick={clearAll} className="text-sm" style={{ color: '#8b7355' }}>
            Clear selections
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {successCount !== null && (
        <p className="text-sm text-green-700">
          Created {successCount} class{successCount !== 1 ? 'es' : ''}.
        </p>
      )}
    </div>
  );
}
