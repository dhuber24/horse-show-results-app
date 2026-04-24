'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Breed {
  id?: string;
  name: string;
  sort_order: number;
}

export default function BreedForm({ breed }: { breed?: Breed }) {
  const router = useRouter();
  const isEdit = !!breed?.id;
  const [form, setForm] = useState({
    name: breed?.name ?? '',
    sort_order: breed?.sort_order ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: name === 'sort_order' ? Number(value) : value }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    setError(null);
    const url = isEdit ? `/api/breeds/${breed!.id}` : '/api/breeds';
    const method = isEdit ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (res.ok) {
      if (isEdit) {
        router.refresh();
      } else {
        router.push('/admin/horses/breeds');
        router.refresh();
      }
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? `Failed to ${isEdit ? 'update' : 'create'} breed.`);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    const res = await fetch(`/api/breeds/${breed!.id}`, { method: 'DELETE' });
    setDeleting(false);
    if (res.ok) {
      router.push('/admin/horses/breeds');
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to delete breed. It may be in use by existing horses.');
    }
  };

  return (
    <div className="border rounded-lg p-4 space-y-3" style={{ borderColor: '#d4b896' }}>
      <div>
        <label className="text-sm" style={{ color: '#8b7355' }}>Name *</label>
        <input
          name="name"
          value={form.name}
          onChange={handleChange}
          placeholder="e.g. American Quarter Horse"
          className="w-full border rounded px-3 py-2 mt-1"
        />
      </div>
      <div>
        <label className="text-sm" style={{ color: '#8b7355' }}>Sort Order</label>
        <input
          name="sort_order"
          type="number"
          value={form.sort_order}
          onChange={handleChange}
          className="w-full border rounded px-3 py-2 mt-1"
        />
        <p className="text-xs mt-1" style={{ color: '#8b7355' }}>
          Lower numbers appear first in dropdowns.
        </p>
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 rounded font-medium disabled:opacity-50"
          style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
        >
          {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Breed'}
        </button>
        {isEdit && (!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)} className="text-sm text-red-600 hover:text-red-800">
            Delete
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
            <button onClick={() => setConfirmDelete(false)} className="text-sm text-gray-500 hover:text-gray-700">
              Cancel
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
