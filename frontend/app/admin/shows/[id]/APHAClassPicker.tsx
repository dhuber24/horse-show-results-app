'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { getShowDates } from './showDateUtils';

interface StandardClass {
  code: string;
  name: string;
  division: string;
  sort_order: number;
  auto_discipline?: string | null;
  auto_score_type?: 'placement' | 'pattern' | 'time' | null;
}

export default function APHAClassPicker({
  showId,
  showStartDate,
  showEndDate,
  existingAphaCodes,
}: {
  showId: string;
  showStartDate: string;
  showEndDate: string;
  existingAphaCodes: string[];
}) {
  const router = useRouter();
  const showDates = useMemo(() => getShowDates(showStartDate, showEndDate), [showStartDate, showEndDate]);
  const [open, setOpen] = useState(false);
  const [allClasses, setAllClasses] = useState<StandardClass[]>([]);
  const [divisions, setDivisions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState('');
  const [divisionFilter, setDivisionFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [classDate, setClassDate] = useState(showStartDate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);

  useEffect(() => {
    if (!open || allClasses.length > 0) return;
    setLoading(true);
    Promise.all([
      fetch('/api/apha-standard-classes').then((r) => r.json()),
      fetch('/api/apha-standard-classes/divisions').then((r) => r.json()),
    ])
      .then(([classes, divs]) => {
        setAllClasses(Array.isArray(classes) ? classes : []);
        setDivisions(Array.isArray(divs) ? divs : []);
      })
      .catch(() => setError('Failed to load APHA class list.'))
      .finally(() => setLoading(false));
  }, [open, allClasses.length]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return allClasses.filter((c) => {
      if (divisionFilter && c.division !== divisionFilter) return false;
      if (q && !c.code.toLowerCase().includes(q) && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allClasses, search, divisionFilter]);

  const selectableFiltered = filtered.filter((c) => !existingAphaCodes.includes(c.code));

  const toggleAll = () => {
    if (selectableFiltered.every((c) => selected.has(c.code))) {
      setSelected((prev) => {
        const next = new Set(prev);
        selectableFiltered.forEach((c) => next.delete(c.code));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        selectableFiltered.forEach((c) => next.add(c.code));
        return next;
      });
    }
  };

  const toggle = (code: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  };

  const handleAdd = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    setError(null);
    setSuccessCount(null);

    const orderedCodes = allClasses
      .filter((c) => selected.has(c.code))
      .map((c) => c.code);

    const classes = orderedCodes.map((code) => ({ apha_code: code }));

    const res = await fetch(`/api/shows/${showId}/classes/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ class_date: classDate, classes }),
    });
    setSaving(false);
    if (res.ok) {
      const data = await res.json();
      setSuccessCount(Array.isArray(data) ? data.length : selected.size);
      setSelected(new Set());
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to add classes.');
    }
  };

  const allFilteredSelected = selectableFiltered.length > 0 && selectableFiltered.every((c) => selected.has(c.code));

  const routingPreview = useMemo(() => {
    const grouped = new Map<string, Map<string, number>>();
    let unrouted = 0;
    for (const c of allClasses) {
      if (!selected.has(c.code)) continue;
      const div = c.auto_discipline || 'Unassigned';
      const sec = c.division || 'Unassigned';
      if (div === 'Unassigned') unrouted += 1;
      const inner = grouped.get(div) ?? new Map<string, number>();
      inner.set(sec, (inner.get(sec) ?? 0) + 1);
      grouped.set(div, inner);
    }
    return { grouped, unrouted };
  }, [allClasses, selected]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm px-4 py-2 rounded border font-medium hover:bg-amber-50"
        style={{ borderColor: '#c9a96e', color: '#7c5c2e' }}
      >
        + Add from APHA Class List
      </button>
    );
  }

  return (
    <div className="border rounded-lg p-4 space-y-4" style={{ borderColor: '#c9a96e', background: '#fffdf8' }}>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold" style={{ color: '#2c1810' }}>Add APHA Classes</h3>
        <button onClick={() => setOpen(false)} className="text-sm" style={{ color: '#8b7355' }}>
          Close
        </button>
      </div>

      {loading && <p className="text-sm" style={{ color: '#8b7355' }}>Loading class list…</p>}

      {!loading && (
        <>
          {/* Filters */}
          <div className="flex gap-3 flex-wrap">
            <input
              type="text"
              placeholder="Search code or name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border rounded px-3 py-1.5 text-sm flex-1 min-w-40"
            />
            <select
              value={divisionFilter}
              onChange={(e) => setDivisionFilter(e.target.value)}
              className="border rounded px-3 py-1.5 text-sm"
            >
              <option value="">All divisions</option>
              {divisions.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          {/* Class list */}
          <div className="border rounded overflow-y-auto" style={{ maxHeight: '320px' }}>
            {filtered.length === 0 ? (
              <p className="p-3 text-sm" style={{ color: '#8b7355' }}>No classes match your filters.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white border-b">
                  <tr>
                    <th className="w-8 px-2 py-2 text-left">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={toggleAll}
                        title={allFilteredSelected ? 'Deselect all visible' : 'Select all visible'}
                      />
                    </th>
                    <th className="px-2 py-2 text-left font-medium" style={{ color: '#5c3d1e' }}>Code</th>
                    <th className="px-2 py-2 text-left font-medium" style={{ color: '#5c3d1e' }}>Name</th>
                    <th className="px-2 py-2 text-left font-medium hidden sm:table-cell" style={{ color: '#5c3d1e' }}>Bracket</th>
                    <th className="px-2 py-2 text-left font-medium hidden md:table-cell" style={{ color: '#5c3d1e' }}>Will create division</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c, i) => {
                    const alreadyAdded = existingAphaCodes.includes(c.code);
                    return (
                      <tr
                        key={c.code}
                        className={alreadyAdded ? 'opacity-40' : 'cursor-pointer hover:bg-amber-50'}
                        style={{ background: selected.has(c.code) ? '#fef3c7' : i % 2 === 0 ? '#fff' : '#fafaf8' }}
                        onClick={() => !alreadyAdded && toggle(c.code)}
                        title={alreadyAdded ? 'Already added to this show' : undefined}
                      >
                        <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={alreadyAdded || selected.has(c.code)} disabled={alreadyAdded} onChange={() => !alreadyAdded && toggle(c.code)} />
                        </td>
                        <td className="px-2 py-1.5 font-mono font-semibold" style={{ color: '#7c5c2e' }}>{c.code}</td>
                        <td className="px-2 py-1.5">{c.name}</td>
                        <td className="px-2 py-1.5 hidden sm:table-cell text-xs" style={{ color: '#8b7355' }}>{c.division}</td>
                        <td className="px-2 py-1.5 hidden md:table-cell text-xs">
                          {c.auto_discipline ? (
                            <span style={{ color: '#3f6b2f' }}>{c.auto_discipline}</span>
                          ) : (
                            <span style={{ color: '#b45309' }}>Unassigned</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {selected.size > 0 && (
            <div
              className="rounded border p-3 text-xs"
              style={{ borderColor: '#c9a96e', background: '#faf6ef' }}
            >
              <p className="font-medium mb-2" style={{ color: '#5c3d1e' }}>
                Will create or extend these divisions:
              </p>
              <ul className="space-y-1">
                {[...routingPreview.grouped.entries()]
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([div, brackets]) => (
                    <li key={div} className="flex items-start gap-2">
                      <span
                        className="font-medium"
                        style={{ color: div === 'Unassigned' ? '#b45309' : '#3f6b2f' }}
                      >
                        {div}
                      </span>
                      <span style={{ color: '#8b7355' }}>
                        ({[...brackets.entries()]
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([sec, n]) => `${sec} ×${n}`)
                          .join(', ')})
                      </span>
                    </li>
                  ))}
              </ul>
              {routingPreview.unrouted > 0 && (
                <p className="mt-2" style={{ color: '#b45309' }}>
                  {routingPreview.unrouted} class{routingPreview.unrouted === 1 ? '' : 'es'} couldn&apos;t be auto-routed —
                  they&apos;ll land in &quot;Unassigned&quot; and need a division pick after import.
                </p>
              )}
            </div>
          )}

          {/* Settings row */}
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
            <button
              onClick={handleAdd}
              disabled={saving || selected.size === 0}
              title={selected.size === 0 ? 'Select at least one class' : saving ? 'Adding…' : undefined}
              className="px-5 py-2 rounded text-white font-medium disabled:opacity-50"
              style={{ background: selected.size === 0 ? '#9ca3af' : '#7c5c2e' }}
            >
              {saving ? 'Adding…' : `Add ${selected.size > 0 ? selected.size : ''} Class${selected.size !== 1 ? 'es' : ''}`}
            </button>
          </div>

          <p className="text-xs" style={{ color: '#8b7355' }}>
            Classes are numbered automatically. Each class is auto-routed into a division and section based on its
            name and APHA bracket; missing divisions/sections are created on the fly.
          </p>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {successCount !== null && (
            <p className="text-sm text-green-700">
              {successCount} class{successCount !== 1 ? 'es' : ''} added successfully.
            </p>
          )}
        </>
      )}
    </div>
  );
}
