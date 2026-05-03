'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Ring { id: string; name: string; }
interface Division { id: string; name: string; }

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
  const [form, setForm] = useState({
    class_name: '',
    class_date: '',
    status: 'OPEN',
    ring_id: '',
    division_id: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
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
        status: form.status,
        ring_id: form.ring_id || null,
        division_id: form.division_id || null,
      }),
    });
    setSaving(false);
    if (res.ok) {
      router.refresh();
      setForm({ class_name: '', class_date: '', status: 'OPEN', ring_id: '', division_id: '' });
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to create class.');
    }
  };

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex gap-3">
        <input name="class_name" placeholder="Class name *" value={form.class_name} onChange={handleChange}
          className="flex-1 border rounded px-3 py-2" />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-sm text-gray-500">Class date *</label>
          <input name="class_date" type="date" min={showStartDate} max={showEndDate} value={form.class_date} onChange={handleChange}
            className="w-full border rounded px-3 py-2" />
        </div>
        <div className="flex-1">
          <label className="text-sm text-gray-500">Status</label>
          <select name="status" value={form.status} onChange={handleChange}
            className="w-full border rounded px-3 py-2">
            <option value="OPEN">Open</option>
            <option value="CLOSED">Closed</option>
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
      <button onClick={handleSubmit} disabled={saving}
        className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 disabled:opacity-50">
        {saving ? 'Adding…' : 'Add Class'}
      </button>
    </div>
  );
}
