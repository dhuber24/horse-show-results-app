'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { APHA_DIVISIONS, RELATIONSHIP_OPTIONS, RELATIONSHIP_REQUIRED_DIVISIONS } from '@/lib/apha';
import HorseDocuments, { HEALTH_DOC_TYPES } from '@/components/HorseDocuments';

interface Props {
  showId: string;
  classes: any[];
  exhibitors: any[];
  isAphaShow: boolean;
}

function formatBackendDetail(detail: any, fallback: string) {
  if (typeof detail === 'string') return detail;
  if (detail?.code === 'ASSOCIATION_VALIDATION_FAILED' && Array.isArray(detail.issues)) {
    return detail.issues
      .filter((issue: any) => issue.severity === 'error')
      .map((issue: any) => issue.message)
      .join(' ');
  }
  return detail?.message ?? fallback;
}

export default function CreateEntryForm({ showId, classes, exhibitors, isAphaShow }: Props) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({
    classId: '',
    exhibitor_id: '',
    horse_id: '',
    back_number: '',
    apha_division: '',
    relationship_to_owner: '',
    is_disqualified: false,
  });
  const [exhibitorHorses, setExhibitorHorses] = useState<any[]>([]);
  const [horsesLoading, setHorsesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPapers, setShowPapers] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'exhibitor_id') {
      setForm((prev) => ({ ...prev, exhibitor_id: value, horse_id: '' }));
      setExhibitorHorses([]);
      if (value) {
        setHorsesLoading(true);
        fetch(`/api/exhibitors/${value}/my-horses`)
          .then((r) => r.json())
          .then((data) => setExhibitorHorses(Array.isArray(data) ? data : []))
          .catch(() => setExhibitorHorses([]))
          .finally(() => setHorsesLoading(false));
      }
      return;
    }
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const selectedHorse = exhibitorHorses.find((h) => h.id === form.horse_id);
  const showSpbWarning =
    isAphaShow &&
    form.apha_division === 'OPEN' &&
    selectedHorse?.is_solid_paint_bred === true;

  const showRelationship =
    isAphaShow && RELATIONSHIP_REQUIRED_DIVISIONS.has(form.apha_division);

  const handleSubmit = async () => {
    if (!form.classId || !form.exhibitor_id || !form.horse_id) {
      setError('Class, exhibitor, and horse are required.');
      return;
    }
    if (showSpbWarning) {
      setError('Solid Paint-Bred horses may not enter Open division classes (APHA SC-325.A.1).');
      return;
    }

    setSaving(true);
    setError(null);
    setShowPapers(false);

    const body: Record<string, unknown> = {
      showId,
      classId: form.classId,
      exhibitor_id: form.exhibitor_id,
      horse_id: form.horse_id,
      back_number: form.back_number ? parseInt(form.back_number) : null,
      is_disqualified: form.is_disqualified,
    };
    if (isAphaShow && form.apha_division) body.apha_division = form.apha_division;
    if (isAphaShow && form.relationship_to_owner) body.relationship_to_owner = form.relationship_to_owner;

    const res = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);

    if (res.ok) {
      router.refresh();
      setForm({ classId: '', exhibitor_id: '', horse_id: '', back_number: '', apha_division: '', relationship_to_owner: '', is_disqualified: false });
    } else {
      const err = await res.json().catch(() => ({}));
      setError(formatBackendDetail(err.detail, 'Failed to add entry. May already exist.'));
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="w-full border-2 border-dashed rounded-lg p-3 text-sm font-medium hover:bg-amber-50 transition-colors"
        style={{ borderColor: '#d4b896', color: '#8b4513' }}
      >
        + Add Entry
      </button>
    );
  }

  return (
    <div className="border rounded-lg p-4 space-y-3" style={{ borderColor: '#d4b896' }}>
      <div className="flex items-center justify-between -mt-1">
        <h3 className="text-sm font-semibold" style={{ color: '#2c1810' }}>Add Entry</h3>
        <button
          onClick={() => { setIsOpen(false); setError(null); setShowPapers(false); }}
          className="text-xs hover:underline"
          style={{ color: '#8b7355' }}
        >
          Cancel
        </button>
      </div>
      <select name="classId" value={form.classId} onChange={handleChange}
        className="w-full border rounded px-3 py-2">
        <option value="">Select class *</option>
        {classes.map((c) => (
          <option key={c.id} value={c.id}>{c.class_number} — {c.class_name}</option>
        ))}
      </select>
      <div className="flex gap-3">
        <select name="exhibitor_id" value={form.exhibitor_id} onChange={handleChange}
          className="flex-1 border rounded px-3 py-2">
          <option value="">Select exhibitor *</option>
          {exhibitors.map((r) => (
            <option key={r.id} value={r.id}>{r.full_name}</option>
          ))}
        </select>
        <select
          name="horse_id"
          value={form.horse_id}
          onChange={handleChange}
          disabled={!form.exhibitor_id || horsesLoading}
          className="flex-1 border rounded px-3 py-2 disabled:opacity-50"
          title={!form.exhibitor_id ? 'Select an exhibitor first' : undefined}
        >
          <option value="">
            {!form.exhibitor_id
              ? 'Select exhibitor first'
              : horsesLoading
              ? 'Loading horses…'
              : exhibitorHorses.length === 0
              ? 'No horses on profile'
              : 'Select horse *'}
          </option>
          {exhibitorHorses.map((h) => (
            <option key={h.id} value={h.id}>{h.name}{h.is_solid_paint_bred ? ' (SPB)' : ''}</option>
          ))}
        </select>
      </div>
      <input name="back_number" type="number" placeholder="Back number" value={form.back_number}
        onChange={handleChange} className="w-32 border rounded px-3 py-2" />

      {isAphaShow && (
        <div className="space-y-3 pt-1 border-t" style={{ borderColor: '#e8d5b7' }}>
          <p className="text-xs font-semibold pt-2" style={{ color: '#8b4513' }}>APHA</p>
          <div className="flex gap-3 flex-wrap">
            <div className="flex-1 min-w-[160px]">
              <label className="text-sm block mb-1 text-gray-500">Division</label>
              <select name="apha_division" value={form.apha_division} onChange={handleChange}
                className="w-full border rounded px-3 py-2">
                <option value="">— Not specified —</option>
                {APHA_DIVISIONS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
            {showRelationship && (
              <div className="flex-1 min-w-[160px]">
                <label className="text-sm block mb-1 text-gray-500">Relationship to Owner</label>
                <select name="relationship_to_owner" value={form.relationship_to_owner} onChange={handleChange}
                  className="w-full border rounded px-3 py-2">
                  <option value="">— Not specified —</option>
                  {RELATIONSHIP_OPTIONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_disqualified"
              checked={form.is_disqualified}
              onChange={(e) => setForm((prev) => ({ ...prev, is_disqualified: e.target.checked }))}
              className="h-4 w-4"
            />
            <label htmlFor="is_disqualified" className="text-sm text-gray-500">
              Disqualified (DQ) — entry still counted, no placing recorded
            </label>
          </div>
          {showSpbWarning && (
            <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
              Solid Paint-Bred horses may not enter Open division classes (APHA SC-325.A.1).
            </div>
          )}
        </div>
      )}

      {/* Health paperwork does not gate the entry, so this is a look, not a
          checkpoint — anything short shows up on the Entries page health flags
          and stays there until the exhibitor fixes it. */}
      {form.horse_id && (
        <div className="pt-1">
          <button
            onClick={() => setShowPapers((v) => !v)}
            className="text-sm font-medium hover:underline"
            style={{ color: '#8b4513' }}
          >
            {showPapers ? 'Hide health documents' : 'View health documents on file'}
          </button>
          {showPapers && (
            <div className="mt-2 rounded border bg-white p-3" style={{ borderColor: '#e8d5b7' }}>
              <HorseDocuments
                horseId={form.horse_id}
                types={HEALTH_DOC_TYPES}
                emptyLabel="No health documents uploaded for this horse."
                readOnly
              />
            </div>
          )}
        </div>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button onClick={handleSubmit} disabled={saving || showSpbWarning}
        className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 disabled:opacity-50">
        {saving ? 'Adding...' : 'Add Entry'}
      </button>
    </div>
  );
}
