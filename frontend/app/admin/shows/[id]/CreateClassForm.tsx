'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { getShowDates } from './showDateUtils';

type ScoreType = 'placement' | 'pattern' | 'time';

interface Ring { id: string; name: string; }
interface Division { id: string; name: string; default_score_type: ScoreType; }
interface Section { id: string; name: string; division_ids?: string[]; }

const SCORE_TYPE_LABEL: Record<ScoreType, string> = {
  placement: 'Placement',
  pattern: 'Pattern',
  time: 'Timed',
};

const EMPTY_FORM: {
  class_name: string;
  class_date: string;
  ring_id: string;
  division_id: string;
  section_id: string;
} = { class_name: '', class_date: '', ring_id: '', division_id: '', section_id: '' };

export default function CreateClassForm({
  showId, showStartDate, showEndDate, rings, divisions, sections,
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
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedDivision = useMemo(
    () => divisions.find((d) => d.id === form.division_id) ?? null,
    [divisions, form.division_id],
  );

  const sectionsForDivision = useMemo(
    () =>
      form.division_id
        ? sections.filter((s) => (s.division_ids ?? []).includes(form.division_id))
        : [],
    [sections, form.division_id],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm((prev) => {
      // Clearing the division also clears the section — sections are scoped
      // to a division now and the prior pick may no longer be valid.
      if (name === 'division_id') return { ...prev, division_id: value, section_id: '' };
      return { ...prev, [name]: value };
    });
  };

  const handleCancel = () => {
    setOpen(false);
    setForm(EMPTY_FORM);
    setError(null);
  };

  const handleSubmit = async () => {
    if (!form.class_name || !form.class_date) {
      setError('Class name and date are required.');
      return;
    }
    if (!form.division_id) {
      setError('Pick a division.');
      return;
    }
    if (!form.section_id) {
      setError('Pick a section. (Add one on the Setup page and assign it to this division if none are listed.)');
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch('/api/classes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        showId,
        class_name: form.class_name,
        class_date: form.class_date,
        status: 'OPEN',
        ring_id: form.ring_id || null,
        division_id: form.division_id,
        section_id: form.section_id,
      }),
    });
    setSaving(false);
    if (res.ok) {
      router.refresh();
      setOpen(false);
      setForm(EMPTY_FORM);
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to create class.');
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 rounded text-sm font-medium"
        style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
      >
        + Create New Class
      </button>
    );
  }

  return (
    <div className="border rounded-lg p-4 space-y-3" style={{ borderColor: '#d4b896' }}>
      <h3 className="font-semibold text-sm" style={{ color: '#2c1810' }}>Create New Class</h3>
      <div className="flex gap-3">
        <input name="class_name" placeholder="Class name *" value={form.class_name} onChange={handleChange}
          className="flex-1 border rounded px-3 py-2" />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-sm text-gray-500">Class date *</label>
          <select name="class_date" value={form.class_date} onChange={handleChange}
            className="w-full border rounded px-3 py-2">
            <option value="">Select a date…</option>
            {showDates.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>
        {rings.length > 0 && (
          <div className="flex-1">
            <label className="text-sm text-gray-500">Ring</label>
            <select name="ring_id" value={form.ring_id} onChange={handleChange}
              className="w-full border rounded px-3 py-2">
              <option value="">None</option>
              {rings.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        )}
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-sm text-gray-500">Division (discipline) *</label>
          <select name="division_id" value={form.division_id} onChange={handleChange}
            className="w-full border rounded px-3 py-2">
            <option value="">Select…</option>
            {divisions.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="text-sm text-gray-500">Section (bracket) *</label>
          <select
            name="section_id"
            value={form.section_id}
            onChange={handleChange}
            disabled={!form.division_id}
            className="w-full border rounded px-3 py-2 disabled:bg-gray-100"
            title={!form.division_id ? 'Pick a division first' : undefined}
          >
            <option value="">{form.division_id ? 'Select…' : 'Pick a division first'}</option>
            {sectionsForDivision.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {form.division_id && sectionsForDivision.length === 0 && (
            <p className="text-xs mt-1" style={{ color: '#b45309' }}>
              No sections assigned to this division. Add one on the Setup page.
            </p>
          )}
        </div>
      </div>
      <p className="text-xs" style={{ color: '#8b7355' }}>
        Scoring is taken from the division’s default
        {selectedDivision ? (
          <> — <span className="font-medium">{SCORE_TYPE_LABEL[selectedDivision.default_score_type]}</span></>
        ) : (
          <> (Placement when no division is selected)</>
        )}
        . Class number is assigned automatically.
      </p>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex gap-2">
        <button onClick={handleSubmit} disabled={saving}
          className="px-5 py-2 rounded text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}>
          {saving ? 'Adding…' : 'Add Class'}
        </button>
        <button onClick={handleCancel} disabled={saving}
          className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2">
          Cancel
        </button>
      </div>
    </div>
  );
}
