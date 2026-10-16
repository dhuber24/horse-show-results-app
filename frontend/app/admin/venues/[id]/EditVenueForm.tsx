'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api-error';

interface Venue {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip?: string | null;
}

export default function EditVenueForm({ venue }: { venue: Venue }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: venue.name,
    address: venue.address ?? '',
    city: venue.city ?? '',
    state: venue.state ?? '',
    zip: venue.zip ?? '',
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
      setError(errorMessage(await res.json().catch(() => null), 'Failed to update venue.'));
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    const res = await fetch(`/api/venues/${venue.id}`, { method: 'DELETE' });
    setDeleting(false);
    if (res.ok) {
      router.push('/admin');
    } else {
      setConfirmDelete(false);
      setError(errorMessage(
        await res.json().catch(() => null),
        'Failed to delete venue. It may be linked to existing shows.',
      ));
    }
  };

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <input name="name" value={form.name} onChange={handleChange}
        className="w-full border rounded px-3 py-2" placeholder="Venue name *" />
      <input name="address" value={form.address} onChange={handleChange}
        className="w-full border rounded px-3 py-2" placeholder="Address" />
      {/* Wraps on a phone: city on its own line, state and zip under it. */}
      <div className="flex flex-wrap gap-3">
        <input name="city" value={form.city} onChange={handleChange}
          className="flex-1 min-w-[12rem] border rounded px-3 py-2" placeholder="City" />
        <input name="state" value={form.state} onChange={handleChange}
          className="w-24 border rounded px-3 py-2" placeholder="State" />
        <input name="zip" value={form.zip} onChange={handleChange} maxLength={20}
          className="w-28 border rounded px-3 py-2" placeholder="Zip" />
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          title={saving ? 'Saving, please wait…' : undefined}
          className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--text-deep)' }}>Delete this venue?</span>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-xs text-red-600 hover:underline disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Yes, delete'}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
              className="text-xs hover:underline"
              style={{ color: 'var(--muted)' }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-sm text-red-600 hover:text-red-800"
          >
            Delete Venue
          </button>
        )}
      </div>
    </div>
  );
}
