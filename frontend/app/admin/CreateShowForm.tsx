'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function CreateShowForm() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', venue: '', start_date: '', end_date: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async () => {
    if (!form.name || !form.start_date || !form.end_date) {
      setError('Name, start date, and end date are required.');
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch('/api/shows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (res.ok) {
      router.refresh();
      setForm({ name: '', venue: '', start_date: '', end_date: '' });
    } else {
      setError('Failed to create show.');
    }
  };

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <input name="name" placeholder="Show name *" value={form.name} onChange={handleChange}
        className="w-full border rounded px-3 py-2" />
      <input name="venue" placeholder="Venue" value={form.venue} onChange={handleChange}
        className="w-full border rounded px-3 py-2" />
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-sm text-gray-500">Start date *</label>
          <input name="start_date" type="date" value={form.start_date} onChange={handleChange}
            className="w-full border rounded px-3 py-2" />
        </div>
        <div className="flex-1">
          <label className="text-sm text-gray-500">End date *</label>
          <input name="end_date" type="date" value={form.end_date} onChange={handleChange}
            className="w-full border rounded px-3 py-2" />
        </div>
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button onClick={handleSubmit} disabled={saving}
        className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 disabled:opacity-50">
        {saving ? 'Creating...' : 'Create Show'}
      </button>
    </div>
  );
}
