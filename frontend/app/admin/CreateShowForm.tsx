'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Venue {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
}

interface ShowType {
  id: string;
  code: string;
  name: string;
}

export default function CreateShowForm({ venues, showTypes }: { venues: Venue[]; showTypes: ShowType[] }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', venue_id: '', show_type_id: '', start_date: '', end_date: '', apha_show_number: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async () => {
    if (!form.name || !form.start_date || !form.end_date || !form.show_type_id) {
      setError('Name, show type, start date, and end date are required.');
      return;
    }
    setSaving(true);
    setError(null);

    const selectedVenue = venues.find((v) => v.id === form.venue_id);
    const venueLabel = selectedVenue
      ? [selectedVenue.name, selectedVenue.city, selectedVenue.state].filter(Boolean).join(', ')
      : '';

    const res = await fetch('/api/shows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        venue: venueLabel,
        venue_id: form.venue_id || null,
        show_type_id: form.show_type_id,
        start_date: form.start_date,
        end_date: form.end_date,
        apha_show_number: form.apha_show_number || null,
      }),
    });
    setSaving(false);
    if (res.ok) {
      const show = await res.json();
      router.push(`/admin/shows/${show.id}`);
    } else {
      setError('Failed to create show.');
    }
  };

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <input name="name" placeholder="Show name *" value={form.name} onChange={handleChange}
        className="w-full border rounded px-3 py-2" />
      <select name="show_type_id" value={form.show_type_id} onChange={handleChange}
        className="w-full border rounded px-3 py-2">
        <option value="">Select show type *</option>
        {showTypes.map((t) => (
          <option key={t.id} value={t.id}>{t.code} — {t.name}</option>
        ))}
      </select>
      <select name="venue_id" value={form.venue_id} onChange={handleChange}
        className="w-full border rounded px-3 py-2">
        <option value="">Select a venue (optional)</option>
        {venues.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}{v.city ? `, ${v.city}` : ''}{v.state ? `, ${v.state}` : ''}
          </option>
        ))}
      </select>
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
      {showTypes.find((t) => t.id === form.show_type_id)?.code === 'APHA' && (
        <div>
          <label className="text-sm text-gray-500">APHA Show Number</label>
          <input
            name="apha_show_number"
            value={form.apha_show_number}
            onChange={handleChange}
            className="w-full border rounded px-3 py-2"
            placeholder="e.g. 2024-TX-0042"
          />
        </div>
      )}
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button onClick={handleSubmit} disabled={saving}
        className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 disabled:opacity-50">
        {saving ? 'Creating...' : 'Create Show'}
      </button>
    </div>
  );
}
