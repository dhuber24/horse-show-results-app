'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmDialog from '@/components/ConfirmDialog';

interface ShowType { id: string; code: string; name: string; }
interface ClassAssociation {
  id: string;
  class_id: string;
  show_type_id: string;
  show_type_code: string | null;
  show_type_name: string | null;
  association_class_code: string;
}
interface ClassItem {
  id: string;
  class_number: string;
  class_name: string;
  class_date: string;
  status: string;
  associations: ClassAssociation[];
}

const UNCERTIFIED_CODES = ['OPEN'];

export default function EditClassCard({ cls, showId, showStartDate, showEndDate, showTypes }: {
  cls: ClassItem;
  showId: string;
  showStartDate: string;
  showEndDate: string;
  showTypes: ShowType[];
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
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [associations, setAssociations] = useState<ClassAssociation[]>(cls.associations ?? []);
  const [newAssoc, setNewAssoc] = useState({ show_type_id: '', association_class_code: '' });
  const [addingAssoc, setAddingAssoc] = useState(false);
  const [assocError, setAssocError] = useState<string | null>(null);
  const [confirmDeleteAssocId, setConfirmDeleteAssocId] = useState<string | null>(null);

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
    setDeleting(true);
    const res = await fetch('/api/classes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId, classId: cls.id }),
    });
    setDeleting(false);
    if (res.ok) {
      router.refresh();
    } else {
      setConfirmDelete(false);
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

  const handleAddAssoc = async () => {
    if (!newAssoc.show_type_id || !newAssoc.association_class_code.trim()) {
      setAssocError('Select an association and enter a class code.');
      return;
    }
    setAddingAssoc(true);
    setAssocError(null);
    const res = await fetch(`/api/classes/${cls.id}/associations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId, ...newAssoc }),
    });
    setAddingAssoc(false);
    if (res.ok) {
      const created = await res.json();
      setAssociations((prev) => [...prev, created]);
      setNewAssoc({ show_type_id: '', association_class_code: '' });
    } else {
      const err = await res.json().catch(() => ({}));
      setAssocError(err.detail ?? 'Failed to add association.');
    }
  };

  const handleDeleteAssoc = async (assocId: string) => {
    const res = await fetch(`/api/classes/${cls.id}/associations/${assocId}?showId=${showId}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      setAssociations((prev) => prev.filter((a) => a.id !== assocId));
    } else {
      const err = await res.json().catch(() => ({}));
      setAssocError(err.detail ?? 'Failed to remove association.');
    }
  };

  const usedShowTypeIds = new Set(associations.map((a) => a.show_type_id));
  const availableShowTypes = showTypes.filter(
    (st) => !UNCERTIFIED_CODES.includes(st.code) && !usedShowTypeIds.has(st.id),
  );

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
          {associations.map((a) => (
            <span
              key={a.id}
              className="text-xs ml-2 font-mono px-1 rounded"
              style={{ backgroundColor: '#f0e8d8', color: '#8b4513' }}
              title={a.show_type_name ?? undefined}
            >
              {a.show_type_code}:{a.association_class_code}
            </span>
          ))}
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

      <div className="border-t pt-3 space-y-2" style={{ borderColor: '#e8d5b7' }}>
        <label className="text-sm font-medium" style={{ color: '#2c1810' }}>Association class codes</label>
        {associations.length > 0 ? (
          <ul className="space-y-1">
            {associations.map((a) => (
              <li key={a.id} className="flex items-center justify-between p-2 rounded border text-sm"
                style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0' }}>
                <div>
                  <span className="font-mono font-semibold" style={{ color: '#8b4513' }}>{a.show_type_code}</span>
                  <span className="ml-2" style={{ color: '#2c1810' }}>{a.association_class_code}</span>
                </div>
                <button
                  onClick={() => setConfirmDeleteAssocId(a.id)}
                  className="text-xs text-red-600 hover:text-red-800 ml-3 shrink-0"
                >
                  Remove
                </button>
                {confirmDeleteAssocId === a.id && (
                  <ConfirmDialog
                    title="Remove Association"
                    message={`Remove ${a.show_type_code} class code? This cannot be undone.`}
                    confirmLabel="Yes, remove"
                    destructive
                    onConfirm={() => { handleDeleteAssoc(a.id); setConfirmDeleteAssocId(null); }}
                    onCancel={() => setConfirmDeleteAssocId(null)}
                  />
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs" style={{ color: '#8b7355' }}>No association codes set.</p>
        )}
        {availableShowTypes.length > 0 && (
          <div className="flex flex-wrap gap-2 items-end pt-1">
            <div className="flex-1 min-w-[140px]">
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Association</label>
              <select
                value={newAssoc.show_type_id}
                onChange={(e) => setNewAssoc((p) => ({ ...p, show_type_id: e.target.value }))}
                className="w-full border rounded px-3 py-2 text-sm"
              >
                <option value="">Select…</option>
                {availableShowTypes.map((st) => (
                  <option key={st.id} value={st.id}>{st.code} — {st.name}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Class code</label>
              <input
                value={newAssoc.association_class_code}
                onChange={(e) => setNewAssoc((p) => ({ ...p, association_class_code: e.target.value }))}
                placeholder="e.g. WP01, 184/684"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={handleAddAssoc}
              disabled={addingAssoc}
              className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
            >
              {addingAssoc ? 'Adding…' : 'Add'}
            </button>
          </div>
        )}
        {assocError && <p className="text-red-600 text-xs">{assocError}</p>}
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            title={saving ? 'Saving, please wait…' : undefined}
            className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={handleCancel} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">
            Cancel
          </button>
        </div>
        <button
          onClick={() => setConfirmDelete(true)}
          className="text-sm text-red-600 hover:text-red-800"
        >
          Delete
        </button>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete Class"
          message="Delete this class and all its entries? This cannot be undone."
          confirmLabel="Yes, delete"
          destructive
          confirming={deleting}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </li>
  );
}
