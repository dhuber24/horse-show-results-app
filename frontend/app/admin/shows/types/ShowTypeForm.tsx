'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface ShowType {
  id?: string;
  code: string;
  name: string;
  config?: Record<string, unknown>;
}

export default function ShowTypeForm({ showType }: { showType?: ShowType }) {
  const router = useRouter();
  const isEdit = !!showType?.id;
  const [form, setForm] = useState({
    code: showType?.code ?? '',
    name: showType?.name ?? '',
    config: JSON.stringify(showType?.config ?? {}, null, 2),
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSave = async () => {
    if (!form.code || !form.name) {
      setError('Code and name are required.');
      return;
    }
    let configObj: Record<string, unknown> = {};
    try {
      configObj = form.config.trim() ? JSON.parse(form.config) : {};
    } catch {
      setError('Config must be valid JSON.');
      return;
    }

    setSaving(true);
    setError(null);

    const body = { code: form.code.toUpperCase(), name: form.name, config: configObj };
    const url = isEdit ? `/api/show-types/${showType!.id}` : '/api/show-types';
    const method = isEdit ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);

    if (res.ok) {
      if (isEdit) {
        router.refresh();
      } else {
        router.push('/admin/shows/types');
      }
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? `Failed to ${isEdit ? 'update' : 'create'} show type.`);
    }
  };

  const handleDelete = async () => {
    if (!showType?.id) return;
    setDeleting(true);
    const res = await fetch(`/api/show-types/${showType.id}`, { method: 'DELETE' });
    setDeleting(false);
    if (res.ok) {
      router.push('/admin/shows/types');
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to delete show type. It may be in use by existing shows.');
    }
  };

  return (
    <div className="border rounded-lg p-4 space-y-3" style={{ borderColor: '#d4b896' }}>
      <div>
        <label className="text-sm" style={{ color: '#8b7355' }}>Code *</label>
        <input
          name="code"
          value={form.code}
          onChange={handleChange}
          placeholder="e.g. APHA"
          className="w-full border rounded px-3 py-2 font-mono"
        />
      </div>
      <div>
        <label className="text-sm" style={{ color: '#8b7355' }}>Name *</label>
        <input
          name="name"
          value={form.name}
          onChange={handleChange}
          placeholder="e.g. American Paint Horse Association"
          className="w-full border rounded px-3 py-2"
        />
      </div>
      <div>
        <label className="text-sm" style={{ color: '#8b7355' }}>Config (JSON)</label>
        <textarea
          name="config"
          value={form.config}
          onChange={handleChange}
          rows={6}
          className="w-full border rounded px-3 py-2 font-mono text-sm"
          placeholder='{}'
        />
        <p className="text-xs mt-1" style={{ color: '#8b7355' }}>
          Optional per-type configuration (e.g. rule overrides). Leave as {'{}'} for now.
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
          {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Show Type'}
        </button>
        {isEdit && (!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-sm text-red-600 hover:text-red-800"
          >
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
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
