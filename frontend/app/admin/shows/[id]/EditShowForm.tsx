'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Venue {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
}

interface Show {
  id: string;
  name: string;
  venue: string | null;
  venue_id: string | null;
  start_date: string;
  end_date: string;
}

export default function EditShowForm({ show, venues }: { show: Show; venues: Venue[] }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: show.name,
    venue_id: show.venue_id ?? '',
    start_date: show.start_date,
    end_date: show.end_date,
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSave = async () => {
    if (!form.name || !form.start_date || !form.end_date) {
      setError('Name, start date, and end date are required.');
      return;
    }
    setSaving(true);
    setError(null);

    const selectedVenue = venues.find((v) => v.id === form.venue_id);
    const venueLabel = selectedVenue
      ? [selectedVenue.name, selectedVenue.city, selectedVenue.state].filter(Boolean).join(', ')
      : '';

    const res = await fetch(`/api/shows/${show.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        venue: venueLabel,
        venue_id: form.venue_id || null,
        start_date: form.start_date,
        end_date: form.end_date,
      }),
    });
    setSaving(false);
    if (res.ok) {
      router.refresh();
    } else {
      setError('Failed to update show.');
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    const res = await fetch(`/api/shows/${show.id}`, { method: 'DELETE' });
    setDeleting(false);
    if (res.ok) {
      router.push('/admin');
    } else {
      setError('Failed to delete show.');
    }
  };

  return (
    <div className="border rounded-lg p-4 space-y-3" style={{ borderColor: '#d4b896' }}>
      <input name="name" value={form.name} onChange={handleChange}
        className="w-full border rounded px-3 py-2" placeholder="Show name *" />
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
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex items-center justify-between pt-2">
        <button onClick={handleSave} disabled={saving}
          className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)}
            className="text-sm text-red-600 hover:text-red-800">
            Delete Show
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-red-600">Are you sure?</span>
            <button onClick={handleDelete} disabled={deleting}
              className="text-sm bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 disabled:opacity-50">
              {deleting ? 'Deleting...' : 'Yes, Delete'}
            </button>
            <button onClick={() => setConfirmDelete(false)}
              className="text-sm text-gray-500 hover:text-gray-700">
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
