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

export default function EditVenueForm({ venue }: { venue: Venue }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: venue.name,
    address: venue.address ?? '',
    city: venue.city ?? '',
    state: venue.state ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSave = async () => {
    if (!form.name) {
      setError('Venue name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/venues/${venue.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (res.ok) {
      router.refresh();
    } else {
      setError('Failed to update venue.');
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    const res = await fetch(`/api/venues/${venue.id}`, { method: 'DELETE' });
    setDeleting(false);
    if (res.ok) {
      router.push('/admin');
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to delete venue. It may be linked to existing shows.');
    }
  };

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <input name="name" value={form.name} onChange={handleChange}
        className="w-full border rounded px-3 py-2" placeholder="Venue name *" />
      <input name="address" value={form.address} onChange={handleChange}
        className="w-full border rounded px-3 py-2" placeholder="Address" />
      <div className="flex gap-3">
        <input name="city" value={form.city} onChange={handleChange}
          className="flex-1 border rounded px-3 py-2" placeholder="City" />
        <input name="state" value={form.state} onChange={handleChange}
          className="w-24 border rounded px-3 py-2" placeholder="State" />
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
            Delete Venue
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
