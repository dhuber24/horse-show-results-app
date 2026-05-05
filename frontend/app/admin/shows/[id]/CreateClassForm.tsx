'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { getShowDates } from './showDateUtils';

interface Ring { id: string; name: string; }
interface Division { id: string; name: string; }

const EMPTY_FORM = { class_name: '', class_date: '', ring_id: '', division_id: '' };

export default function CreateClassForm({
  showId, showStartDate, showEndDate, rings, divisions,
}: {
  showId: string;
  showStartDate: string;
  showEndDate: string;
  rings: Ring[];
  divisions: Division[];
}) {
  const router = useRouter();
  const showDates = useMemo(() => getShowDates(showStartDate, showEndDate), [showStartDate, showEndDate]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
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
        division_id: form.division_id || null,
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
      </div>
      {(rings.length > 0 || divisions.length > 0) && (
        <div className="flex gap-3">
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
          {divisions.length > 0 && (
            <div className="flex-1">
              <label className="text-sm text-gray-500">Division</label>
              <select name="division_id" value={form.division_id} onChange={handleChange}
                className="w-full border rounded px-3 py-2">
                <option value="">None</option>
                {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}
        </div>
      )}
      <p className="text-xs" style={{ color: '#8b7355' }}>Class number is assigned automatically based on schedule order. Add association codes after creating.</p>
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
