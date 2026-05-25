'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getShowDates } from './showDateUtils';

type ScoreType = 'placement' | 'pattern' | 'time';

interface Ring { id: string; name: string; }

// A valid (discipline × bracket) combination from the standard library join table.
interface Pair {
  divisionName: string;
  sectionName: string;
  scoreType: ScoreType;
  label: string;
  key: string;
}

const SCORE_LABEL: Record<ScoreType, string> = {
  placement: 'Placement',
  pattern: 'Pattern',
  time: 'Time',
};

const SCORE_COLOR: Record<ScoreType, string> = {
  placement: '#7c5c2e',
  pattern: '#3f6b2f',
  time: '#1f4c8a',
};

export default function StandardLibraryClassPicker({
  showId,
  showTypeId,
  showStartDate,
  showEndDate,
  rings,
}: {
  showId: string;
  showTypeId: string;
  showStartDate: string;
  showEndDate: string;
  rings: Ring[];
}) {
  const router = useRouter();
  const showDates = useMemo(() => getShowDates(showStartDate, showEndDate), [showStartDate, showEndDate]);
  const [open, setOpen] = useState(false);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [loading, setLoading] = useState(false);

  const [divisionFilter, setDivisionFilter] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [classDate, setClassDate] = useState(showStartDate);
  const [ringId, setRingId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);

  useEffect(() => {
    if (!open || pairs.length > 0) return;
    setLoading(true);
    fetch(`/api/standard-setup/pairs?show_type_id=${encodeURIComponent(showTypeId)}`)
      .then((r) => r.json())
      .then((data: { division_name: string; section_name: string; score_type: string }[]) => {
        setPairs(
          (Array.isArray(data) ? data : []).map((p) => ({
            divisionName: p.division_name,
            sectionName: p.section_name,
            scoreType: p.score_type as ScoreType,
            label: `${p.section_name} ${p.division_name}`,
            key: `${p.division_name}::${p.section_name}`,
          })),
        );
      })
      .catch(() => setError('Failed to load the standard discipline/bracket library.'))
      .finally(() => setLoading(false));
  }, [open, showTypeId, pairs.length]);

  // Derive unique division and section names for the filter dropdowns.
  const divisionNames = useMemo(
    () => [...new Set(pairs.map((p) => p.divisionName))],
    [pairs],
  );
  const sectionNames = useMemo(
    () => [...new Set(pairs.map((p) => p.sectionName))],
    [pairs],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pairs.filter((p) => {
      if (divisionFilter && p.divisionName !== divisionFilter) return false;
      if (sectionFilter && p.sectionName !== sectionFilter) return false;
      if (q && !p.label.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [pairs, divisionFilter, sectionFilter, search]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.key));

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (allFilteredSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        filtered.forEach((p) => next.delete(p.key));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        filtered.forEach((p) => next.add(p.key));
        return next;
      });
    }
  };

  // Routing preview: group by division → bracket counts (mirrors AQHA/APHA pickers).
  const preview = useMemo(() => {
    const grouped = new Map<string, Map<string, number>>();
    for (const p of pairs) {
      if (!selected.has(p.key)) continue;
      const inner = grouped.get(p.divisionName) ?? new Map<string, number>();
      inner.set(p.sectionName, (inner.get(p.sectionName) ?? 0) + 1);
      grouped.set(p.divisionName, inner);
    }
    return grouped;
  }, [pairs, selected]);

  const handleAdd = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    setError(null);
    setSuccessCount(null);
    const picks = pairs
      .filter((p) => selected.has(p.key))
      .map((p) => ({
        division_name: p.divisionName,
        section_name: p.sectionName,
        default_score_type: p.scoreType,
      }));
    const res = await fetch(`/api/shows/${showId}/classes/from-library`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ class_date: classDate, picks, ring_id: ringId || null }),
    });
    setSaving(false);
    if (res.ok) {
      const data = await res.json();
      setSuccessCount(Array.isArray(data) ? data.length : picks.length);
      setSelected(new Set());
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(typeof err?.detail === 'string' ? err.detail : 'Failed to add classes.');
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm px-4 py-2 rounded border font-medium hover:bg-amber-50"
        style={{ borderColor: '#c9a96e', color: '#7c5c2e' }}
      >
        + Add from Standard Library
      </button>
    );
  }

  return (
    <div className="border rounded-lg p-4 space-y-4" style={{ borderColor: '#c9a96e', background: '#fffdf8' }}>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold" style={{ color: '#2c1810' }}>Add Classes from Standard Library</h3>
        <button onClick={() => setOpen(false)} className="text-sm" style={{ color: '#8b7355' }}>
          Close
        </button>
      </div>

      <p className="text-xs" style={{ color: '#8b7355' }}>
        Pick the (discipline × bracket) combinations you want. Each checked row creates one class.
        Missing per-show divisions, sections, and memberships are added automatically.
      </p>

      {loading && <p className="text-sm" style={{ color: '#8b7355' }}>Loading library…</p>}

      {!loading && pairs.length === 0 && (
        <div className="rounded border p-3 text-sm" style={{ borderColor: '#e8d5b7', color: '#8b7355' }}>
          No standard discipline/bracket combinations are defined for this show type.
          Add disciplines and brackets on the{' '}
          <a className="underline" href={`/admin/shows/${showId}/setup`} style={{ color: '#7c5c2e' }}>
            Setup page
          </a>{' '}
          to use the matrix above.
        </div>
      )}

      {!loading && pairs.length > 0 && (
        <>
          <div className="flex gap-3 flex-wrap">
            <input
              type="text"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border rounded px-3 py-1.5 text-sm flex-1 min-w-40"
              style={{ borderColor: '#d4b896' }}
            />
            <select
              value={divisionFilter}
              onChange={(e) => setDivisionFilter(e.target.value)}
              className="border rounded px-3 py-1.5 text-sm"
              style={{ borderColor: '#d4b896' }}
            >
              <option value="">All disciplines</option>
              {divisionNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <select
              value={sectionFilter}
              onChange={(e) => setSectionFilter(e.target.value)}
              className="border rounded px-3 py-1.5 text-sm"
              style={{ borderColor: '#d4b896' }}
            >
              <option value="">All brackets</option>
              {sectionNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>

          <div className="border rounded overflow-y-auto" style={{ maxHeight: '320px', borderColor: '#d4b896' }}>
            {filtered.length === 0 ? (
              <p className="p-3 text-sm" style={{ color: '#8b7355' }}>No combinations match your filters.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white border-b" style={{ borderColor: '#e8d5b7' }}>
                  <tr>
                    <th className="w-8 px-2 py-2 text-left">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={toggleAll}
                        title={allFilteredSelected ? 'Deselect all visible' : 'Select all visible'}
                      />
                    </th>
                    <th className="px-2 py-2 text-left font-medium" style={{ color: '#5c3d1e' }}>Discipline</th>
                    <th className="px-2 py-2 text-left font-medium" style={{ color: '#5c3d1e' }}>Bracket</th>
                    <th className="px-2 py-2 text-left font-medium hidden sm:table-cell" style={{ color: '#5c3d1e' }}>Class name</th>
                    <th className="px-2 py-2 text-left font-medium hidden md:table-cell" style={{ color: '#5c3d1e' }}>Scoring</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p, i) => (
                    <tr
                      key={p.key}
                      className="cursor-pointer hover:bg-amber-50"
                      style={{ background: selected.has(p.key) ? '#fef3c7' : i % 2 === 0 ? '#fff' : '#fafaf8' }}
                      onClick={() => toggle(p.key)}
                    >
                      <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(p.key)} onChange={() => toggle(p.key)} />
                      </td>
                      <td className="px-2 py-1.5" style={{ color: '#2c1810' }}>{p.divisionName}</td>
                      <td className="px-2 py-1.5" style={{ color: '#5c3d1e' }}>{p.sectionName}</td>
                      <td className="px-2 py-1.5 hidden sm:table-cell" style={{ color: '#2c1810' }}>{p.label}</td>
                      <td className="px-2 py-1.5 hidden md:table-cell text-xs">
                        <span
                          className="px-1.5 py-0.5 rounded"
                          style={{ color: SCORE_COLOR[p.scoreType], background: '#f0e8d8' }}
                          title="Inherited from the discipline's default scoring"
                        >
                          {SCORE_LABEL[p.scoreType]}
                        </span>
                      </td>
                    </tr>
                  ))}
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
                {[...preview.entries()]
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([div, brackets]) => (
                    <li key={div} className="flex items-start gap-2">
                      <span className="font-medium" style={{ color: '#3f6b2f' }}>{div}</span>
                      <span style={{ color: '#8b7355' }}>
                        ({[...brackets.entries()]
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([sec, n]) => `${sec} ×${n}`)
                          .join(', ')})
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <div className="flex gap-4 flex-wrap items-end">
            <div>
              <label className="block text-xs mb-1" style={{ color: '#8b7355' }}>Class date *</label>
              <select
                value={classDate}
                onChange={(e) => setClassDate(e.target.value)}
                className="border rounded px-3 py-1.5 text-sm"
                style={{ borderColor: '#d4b896' }}
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
                  style={{ borderColor: '#d4b896' }}
                >
                  <option value="">No ring</option>
                  {rings.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
            )}
            <button
              onClick={handleAdd}
              disabled={saving || selected.size === 0}
              title={selected.size === 0 ? 'Select at least one row' : saving ? 'Adding…' : undefined}
              className="px-5 py-2 rounded text-white font-medium disabled:opacity-50"
              style={{ background: selected.size === 0 ? '#9ca3af' : '#7c5c2e' }}
            >
              {saving ? 'Adding…' : `Add ${selected.size > 0 ? selected.size : ''} Class${selected.size !== 1 ? 'es' : ''}`}
            </button>
          </div>

          <p className="text-xs" style={{ color: '#8b7355' }}>
            Need a discipline or bracket that isn&apos;t listed? Add it on the
            <a className="underline ml-1" href={`/admin/shows/${showId}/setup`} style={{ color: '#7c5c2e' }}>
              Setup page
            </a>{' '}
            and it&apos;ll appear here next time you open the picker.
          </p>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {successCount !== null && (
            <p className="text-sm" style={{ color: '#3f6b2f' }}>
              Added {successCount} class{successCount !== 1 ? 'es' : ''}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
