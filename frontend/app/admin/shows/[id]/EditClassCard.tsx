'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface ClassItem {
  id: string;
  class_number: string;
  class_name: string;
  class_date: string;
  status: string;
}

export default function EditClassCard({ cls, showId, showStartDate, showEndDate }: {
  cls: ClassItem;
  showId: string;
  showStartDate: string;
  showEndDate: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    class_number: cls.class_number,
    class_name: cls.class_name,
    class_date: cls.class_date,
    status: cls.status,
  });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSave = async () => {
    if (!form.class_number || !form.class_name || !form.class_date) {
      setError('All fields are required.');
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch('/api/classes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId, classId: cls.id, ...form }),
    });
    setSaving(false);
    if (res.ok) {
      setEditing(false);
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to update class.');
    }
  };

  const handleDelete = async () => {
    const res = await fetch('/api/classes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId, classId: cls.id }),
    });
    if (res.ok) {
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to delete class.');
    }
  };

  const handleCancel = () => {
    setForm({
      class_number: cls.class_number,
      class_name: cls.class_name,
      class_date: cls.class_date,
      status: cls.status,
    });
    setEditing(false);
    setConfirmDelete(false);
    setError(null);
  };

  if (!editing) {
    return (
      <li
        className="p-3 rounded-lg border flex justify-between items-center cursor-pointer hover:bg-gray-50 transition"
        style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}
        onClick={() => setEditing(true)}
      >
        <div>
          <span className="font-medium" style={{ color: '#2c1810' }}>
            {cls.class_number} — {cls.class_name}
          </span>
          <span className="text-sm ml-2" style={{ color: '#8b7355' }}>{cls.class_date}</span>
        </div>
        <span className="text-xs px-2 py-1 rounded-full"
          style={{ backgroundColor: '#f5ede0', color: '#8b4513' }}>
          {cls.status}
        </span>
      </li>
    );
  }

  return (
    <li className="p-4 rounded-lg border space-y-3" style={{ borderColor: '#d4b896' }}>
      <div className="flex gap-3">
        <input name="class_number" value={form.class_number} onChange={handleChange}
          placeholder="Class #" className="w-24 border rounded px-3 py-2" />
        <input name="class_name" value={form.class_name} onChange={handleChange}
          placeholder="Class name" className="flex-1 border rounded px-3 py-2" />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-sm text-gray-500">Class date</label>
          <input name="class_date" type="date" min={showStartDate} max={showEndDate}
            value={form.class_date} onChange={handleChange}
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
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button onClick={handleSave} disabled={saving}
            className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={handleCancel}
            className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">
            Cancel
          </button>
        </div>
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)}
            className="text-sm text-red-600 hover:text-red-800">
            Delete
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-red-600">Are you sure?</span>
            <button onClick={handleDelete}
              className="text-sm bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700">
              Yes, Delete
            </button>
            <button onClick={() => setConfirmDelete(false)}
              className="text-sm text-gray-500 hover:text-gray-700">
              No
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
