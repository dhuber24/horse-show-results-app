'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Horse {
  id: string;
  name: string;
  owner_name: string | null;
}

export default function EditHorseForm({ horse }: { horse: Horse }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: horse.name,
    owner_name: horse.owner_name ?? '',
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
      setError('Horse name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/horses/${horse.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (res.ok) {
      router.refresh();
    } else {
      setError('Failed to update horse.');
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    const res = await fetch(`/api/horses/${horse.id}`, { method: 'DELETE' });
    setDeleting(false);
    if (res.ok) {
      router.push('/admin/horses');
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to delete horse. It may be linked to existing entries.');
    }
  };

  return (
    <div className="border rounded-lg p-4 space-y-3" style={{ borderColor: '#d4b896' }}>
      <input
        name="name"
        value={form.name}
        onChange={handleChange}
        className="w-full border rounded px-3 py-2"
        placeholder="Horse name *"
      />
      <input
        name="owner_name"
        value={form.owner_name}
        onChange={handleChange}
        className="w-full border rounded px-3 py-2"
        placeholder="Owner name"
      />
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 rounded font-medium disabled:opacity-50"
          style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-sm text-red-600 hover:text-red-800"
          >
            Delete Horse
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-red-600">Are you sure?</span>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-sm bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? 'Deleting...' : 'Yes, Delete'}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
