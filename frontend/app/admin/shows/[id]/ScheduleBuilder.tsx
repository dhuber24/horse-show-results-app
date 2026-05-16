'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { getShowDates } from './showDateUtils';

interface Ring { id: string; name: string; }
interface Division { id: string; name: string; }
type ScoreType = 'placement' | 'pattern' | 'time';
type Category = 'halter' | 'showmanship' | 'rail' | 'pattern' | 'speed' | 'other';

interface ClassTemplate {
  id: string;
  show_id: string | null;
  name: string;
  default_score_type: ScoreType;
  category: Category;
  sort_order: number;
  is_seed: boolean;
}

// Sentinel division id for the "(no division)" column. The builder swaps this
// for an empty division_ids list when calling the backend so the class is
// created with no division attached.
const NO_DIVISION = '__none__';

const CATEGORY_LABELS: Record<Category, string> = {
  halter: 'Halter',
  showmanship: 'Showmanship',
  rail: 'Rail',
  pattern: 'Pattern',
  speed: 'Speed',
  other: 'Other',
};

export default function ScheduleBuilder({
  showId,
  showStartDate,
  showEndDate,
  rings,
  divisions: initialDivisions,
  templates: initialTemplates,
}: {
  showId: string;
  showStartDate: string;
  showEndDate: string;
  rings: Ring[];
  divisions: Division[];
  templates: ClassTemplate[];
}) {
  const router = useRouter();
  const showDates = useMemo(() => getShowDates(showStartDate, showEndDate), [showStartDate, showEndDate]);

  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<ClassTemplate[]>(initialTemplates);
  const [divisions, setDivisions] = useState<Division[]>(initialDivisions);

  const [classDate, setClassDate] = useState(showStartDate);
  const [ringId, setRingId] = useState<string>('');

  // checks: Map<templateId, Set<divisionId | NO_DIVISION>>
  const [checks, setChecks] = useState<Record<string, Set<string>>>({});

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);

  // Custom template add
  const [showAddTemplate, setShowAddTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateScore, setNewTemplateScore] = useState<ScoreType>('placement');
  const [newTemplateCategory, setNewTemplateCategory] = useState<Category>('rail');
  const [templateAdding, setTemplateAdding] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);

  // Custom division add
  const [showAddDivision, setShowAddDivision] = useState(false);
  const [newDivisionName, setNewDivisionName] = useState('');
  const [divisionAdding, setDivisionAdding] = useState(false);
  const [divisionError, setDivisionError] = useState<string | null>(null);

  // Columns: every show division, plus a "(no division)" column at the end.
  const columns = useMemo(
    () => [...divisions, { id: NO_DIVISION, name: '(no division)' }],
    [divisions],
  );

  const totalSelected = useMemo(
    () => Object.values(checks).reduce((n, s) => n + s.size, 0),
    [checks],
  );

  const toggleCell = (templateId: string, divisionId: string) => {
    setChecks((prev) => {
      const next = { ...prev };
      const row = new Set(next[templateId] ?? []);
      if (row.has(divisionId)) row.delete(divisionId);
      else row.add(divisionId);
      if (row.size === 0) delete next[templateId];
      else next[templateId] = row;
      return next;
    });
  };

  const toggleRow = (templateId: string) => {
    setChecks((prev) => {
      const next = { ...prev };
      const row = next[templateId] ?? new Set<string>();
      const allColIds = columns.map((c) => c.id);
      const allSelected = allColIds.every((cid) => row.has(cid));
      if (allSelected) {
        delete next[templateId];
      } else {
        next[templateId] = new Set(allColIds);
      }
      return next;
    });
  };

  const toggleColumn = (divisionId: string) => {
    setChecks((prev) => {
      const next: Record<string, Set<string>> = {};
      const allSelected = templates.every((t) => prev[t.id]?.has(divisionId));
      for (const t of templates) {
        const row = new Set(prev[t.id] ?? []);
        if (allSelected) row.delete(divisionId);
        else row.add(divisionId);
        if (row.size > 0) next[t.id] = row;
      }
      return next;
    });
  };

  const clearAll = () => setChecks({});

  const handleAddTemplate = async () => {
    const name = newTemplateName.trim();
    if (!name) {
      setTemplateError('Template name is required.');
      return;
    }
    setTemplateAdding(true);
    setTemplateError(null);
    const res = await fetch(`/api/shows/${showId}/schedule-builder/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        default_score_type: newTemplateScore,
        category: newTemplateCategory,
      }),
    });
    setTemplateAdding(false);
    if (res.ok) {
      const created: ClassTemplate = await res.json();
      setTemplates((prev) => [...prev, created]);
      setNewTemplateName('');
      setShowAddTemplate(false);
    } else {
      const err = await res.json().catch(() => ({}));
      setTemplateError(err.detail ?? 'Failed to add template.');
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    const res = await fetch(`/api/shows/${showId}/schedule-builder/templates/${templateId}`, {
      method: 'DELETE',
    });
    if (res.status === 204) {
      setTemplates((prev) => prev.filter((t) => t.id !== templateId));
      setChecks((prev) => {
        const next = { ...prev };
        delete next[templateId];
        return next;
      });
    }
  };

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
      body: JSON.stringify({ name }),
    });
    setDivisionAdding(false);
    if (res.ok) {
      const created: Division = await res.json();
      setDivisions((prev) => [...prev, created]);
      setNewDivisionName('');
      setShowAddDivision(false);
    } else {
      const err = await res.json().catch(() => ({}));
      setDivisionError(err.detail ?? 'Failed to add division.');
    }
  };

  const handleBuild = async () => {
    if (totalSelected === 0) return;
    setSaving(true);
    setError(null);
    setSuccessCount(null);

    const picks = Object.entries(checks)
      .map(([templateId, divSet]) => {
        const divisionIds = Array.from(divSet).filter((d) => d !== NO_DIVISION);
        const wantsNoDivision = divSet.has(NO_DIVISION);
        const items: { template_id: string; division_ids: string[] }[] = [];
        if (divisionIds.length > 0) {
          items.push({ template_id: templateId, division_ids: divisionIds });
        }
        if (wantsNoDivision) {
          items.push({ template_id: templateId, division_ids: [] });
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
            Pick the classes to add. Each checked cell creates one numbered class.
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
          No divisions yet. Add age/skill divisions below or in <span className="font-medium">Setup → Divisions</span>, then check cells.
          You can also leave divisions empty and use the <span className="font-medium">(no division)</span> column for standalone classes.
        </p>
      )}

      {/* Matrix */}
      <div className="border rounded overflow-x-auto" style={{ maxHeight: '420px', overflowY: 'auto' }}>
        <table className="text-sm" style={{ minWidth: '100%' }}>
          <thead className="sticky top-0 bg-white border-b">
            <tr>
              <th className="px-2 py-2 text-left font-medium" style={{ color: '#5c3d1e' }}>
                Class template
              </th>
              <th className="px-2 py-2 text-center font-medium w-10" title="Toggle whole row" style={{ color: '#5c3d1e' }}>
                All
              </th>
              {columns.map((c) => {
                const allColSelected = templates.length > 0 && templates.every((t) => checks[t.id]?.has(c.id));
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
            {templates.map((t, i) => {
              const row = checks[t.id] ?? new Set<string>();
              const allRowSelected = columns.every((c) => row.has(c.id));
              return (
                <tr key={t.id} style={{ background: i % 2 === 0 ? '#fff' : '#fafaf8' }}>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span style={{ color: '#2c1810' }}>{t.name}</span>
                      <span
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{ color: '#7c5c2e', background: '#fef3c7' }}
                        title={`Default score type: ${t.default_score_type}`}
                      >
                        {CATEGORY_LABELS[t.category]}
                      </span>
                      {!t.is_seed && (
                        <button
                          type="button"
                          onClick={() => handleDeleteTemplate(t.id)}
                          className="text-xs text-red-600 hover:underline"
                          title="Delete custom template"
                        >
                          remove
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      checked={allRowSelected}
                      onChange={() => toggleRow(t.id)}
                      title={allRowSelected ? 'Clear this row' : 'Select all in this row'}
                    />
                  </td>
                  {columns.map((c) => (
                    <td key={c.id} className="px-2 py-1.5 text-center" onClick={() => toggleCell(t.id, c.id)} style={{ cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={row.has(c.id)}
                        onChange={() => toggleCell(t.id, c.id)}
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

      {/* Custom template + division add */}
      <div className="flex gap-4 flex-wrap">
        {!showAddTemplate ? (
          <button
            type="button"
            onClick={() => setShowAddTemplate(true)}
            className="text-xs hover:underline"
            style={{ color: '#7c5c2e' }}
          >
            + Add custom template
          </button>
        ) : (
          <div className="flex gap-2 flex-wrap items-end p-2 rounded" style={{ background: '#f7efe1' }}>
            <input
              autoFocus
              placeholder="Template name"
              value={newTemplateName}
              onChange={(e) => setNewTemplateName(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            />
            <select
              value={newTemplateScore}
              onChange={(e) => setNewTemplateScore(e.target.value as ScoreType)}
              className="border rounded px-2 py-1 text-sm"
              title="How is this class scored?"
            >
              <option value="placement">Placement</option>
              <option value="pattern">Pattern</option>
              <option value="time">Timed</option>
            </select>
            <select
              value={newTemplateCategory}
              onChange={(e) => setNewTemplateCategory(e.target.value as Category)}
              className="border rounded px-2 py-1 text-sm"
            >
              {(Object.keys(CATEGORY_LABELS) as Category[]).map((k) => (
                <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>
              ))}
            </select>
            <button
              onClick={handleAddTemplate}
              disabled={templateAdding}
              className="px-3 py-1 rounded text-white text-sm disabled:opacity-50"
              style={{ background: '#7c5c2e' }}
            >
              {templateAdding ? 'Adding…' : 'Add'}
            </button>
            <button
              onClick={() => { setShowAddTemplate(false); setTemplateError(null); }}
              className="text-sm text-gray-500"
            >
              Cancel
            </button>
            {templateError && <span className="text-xs text-red-600 w-full">{templateError}</span>}
          </div>
        )}

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
          <div className="flex gap-2 flex-wrap items-end p-2 rounded" style={{ background: '#f7efe1' }}>
            <input
              autoFocus
              placeholder="Division name (e.g. 10 & Under)"
              value={newDivisionName}
              onChange={(e) => setNewDivisionName(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            />
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
            {divisionError && <span className="text-xs text-red-600 w-full">{divisionError}</span>}
          </div>
        )}
      </div>

      <p className="text-xs" style={{ color: '#8b7355' }}>
        Class numbers continue from the show&apos;s current schedule. Names are auto-generated as
        {' '}&ldquo;{'{Division}'} {'{Template}'}&rdquo; (e.g. &ldquo;10 &amp; Under Showmanship&rdquo;).
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
