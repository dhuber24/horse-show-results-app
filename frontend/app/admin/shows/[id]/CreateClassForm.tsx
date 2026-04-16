'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function CreateClassForm({ showId, showStartDate, showEndDate }: { showId: string; showStartDate: string; showEndDate: string }) {
  const router = useRouter();
  const [form, setForm] = useState({ class_number: '', class_name: '', class_date: '', status: 'OPEN' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async () => {
    if (!form.class_number || !form.class_name || !form.class_date) {
      setError('All fields are required.');
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch('/api/classes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId, ...form }),
    });
    setSaving(false);
    if (res.ok) {
      router.refresh();
      setForm({ class_number: '', class_name: '', class_date: '', status: 'OPEN' });
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to create class.');
    }
  };

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex gap-3">
        <input name="class_number" placeholder="Class # *" value={form.class_number} onChange={handleChange}
          className="w-24 border rounded px-3 py-2" />
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
            <option value="IN_PROGRESS">In Progress</option>
            <option value="CLOSED">Closed</option>
          </select>
        </div>
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button onClick={handleSubmit} disabled={saving}
        className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 disabled:opacity-50">
        {saving ? 'Adding...' : 'Add Class'}
      </button>
    </div>
  );
}
