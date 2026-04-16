'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  showId: string;
  classes: any[];
  horses: any[];
  exhibitors: any[];
}

export default function CreateEntryForm({ showId, classes, horses, exhibitors }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({ classId: '', exhibitor_id: '', horse_id: '', back_number: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async () => {
    if (!form.classId || !form.exhibitor_id || !form.horse_id) {
      setError('Class, exhibitor, and horse are required.');
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        showId,
        classId: form.classId,
        exhibitor_id: form.exhibitor_id,
        horse_id: form.horse_id,
        back_number: form.back_number ? parseInt(form.back_number) : null,
      }),
    });
    setSaving(false);
    if (res.ok) {
      router.refresh();
      setForm({ classId: '', exhibitor_id: '', horse_id: '', back_number: '' });
    } else {
      setError('Failed to add entry. May already exist.');
    }
  };

  return (
    <div className="border rounded-lg p-4 space-y-3">
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
        <select name="horse_id" value={form.horse_id} onChange={handleChange}
          className="flex-1 border rounded px-3 py-2">
          <option value="">Select horse *</option>
          {horses.map((h) => (
            <option key={h.id} value={h.id}>{h.name}</option>
          ))}
        </select>
      </div>
      <input name="back_number" type="number" placeholder="Back number" value={form.back_number}
        onChange={handleChange} className="w-32 border rounded px-3 py-2" />
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button onClick={handleSubmit} disabled={saving}
        className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 disabled:opacity-50">
        {saving ? 'Adding...' : 'Add Entry'}
      </button>
    </div>
  );
}
