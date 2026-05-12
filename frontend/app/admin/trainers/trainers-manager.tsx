'use client';

import { useMemo, useState } from 'react';

interface Trainer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

interface Props {
  initialTrainers: Trainer[];
}

const emptyForm = { name: '', phone: '', email: '' };

export default function TrainersManager({ initialTrainers }: Props) {
  const [trainers, setTrainers] = useState<Trainer[]>(initialTrainers);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sorted = useMemo(() => [...trainers].sort((a, b) => a.name.localeCompare(b.name)), [trainers]);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setError(null);
    const res = await fetch('/api/trainers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to add trainer.');
      return;
    }
    const created = await res.json();
    setTrainers((prev) => [...prev, created]);
    setForm(emptyForm);
  };

  const startEdit = (trainer: Trainer) => {
    setEditingId(trainer.id);
    setEditForm({ name: trainer.name, phone: trainer.phone ?? '', email: trainer.email ?? '' });
    setError(null);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editForm.name.trim()) return;
    const res = await fetch(`/api/trainers/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editForm.name.trim(),
        phone: editForm.phone.trim() || null,
        email: editForm.email.trim() || null,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to update trainer.');
      return;
    }
    const updated = await res.json();
    setTrainers((prev) => prev.map((t) => (t.id === editingId ? updated : t)));
    setEditingId(null);
    setEditForm(emptyForm);
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/trainers/${id}`, { method: 'DELETE' });
    if (res.ok || res.status === 204) {
      setTrainers((prev) => prev.filter((t) => t.id !== id));
      setConfirmDeleteId(null);
      return;
    }
    const err = await res.json().catch(() => ({}));
    setError(err.detail ?? 'Failed to delete trainer.');
  };

  return (
    <div className="space-y-6">
      <section className="border rounded-lg p-4 space-y-3" style={{ borderColor: '#d4b896' }}>
        <h2 className="font-semibold" style={{ color: '#2c1810' }}>Add Trainer</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Name *" className="border rounded px-3 py-2 text-sm" style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }} />
          <input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} placeholder="Phone" className="border rounded px-3 py-2 text-sm" style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }} />
          <input value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} placeholder="Email" className="border rounded px-3 py-2 text-sm" style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }} />
        </div>
        <button onClick={handleCreate} className="px-4 py-2 rounded text-sm font-medium" style={{ backgroundColor: '#8b4513', color: '#ffffff' }}>Add Trainer</button>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold" style={{ color: '#2c1810' }}>All Trainers ({sorted.length})</h2>
        {sorted.length === 0 ? (
          <p className="text-sm" style={{ color: '#8b7355' }}>No trainers yet.</p>
        ) : (
          <ul className="space-y-2">
            {sorted.map((trainer) => (
              <li key={trainer.id} className="border rounded p-3" style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}>
                {editingId === trainer.id ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input value={editForm.name} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} className="border rounded px-3 py-2 text-sm" style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }} />
                      <input value={editForm.phone} onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))} className="border rounded px-3 py-2 text-sm" style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }} />
                      <input value={editForm.email} onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))} className="border rounded px-3 py-2 text-sm" style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }} />
                    </div>
                    <div className="flex gap-3">
                      <button onClick={handleSaveEdit} className="text-sm font-medium" style={{ color: '#8b4513' }}>Save</button>
                      <button onClick={() => setEditingId(null)} className="text-sm" style={{ color: '#8b7355' }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium" style={{ color: '#2c1810' }}>{trainer.name}</p>
                      <p className="text-sm" style={{ color: '#8b7355' }}>
                        {trainer.phone || 'No phone'}{trainer.email ? ` • ${trainer.email}` : ' • No email'}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={() => startEdit(trainer)} className="text-sm font-medium" style={{ color: '#8b4513' }}>Edit</button>
                      {confirmDeleteId === trainer.id ? (
                        <span className="flex items-center gap-2">
                          <span className="text-xs" style={{ color: '#8b7355' }}>Delete?</span>
                          <button onClick={() => handleDelete(trainer.id)} className="text-xs text-red-600 hover:underline">Yes</button>
                          <button onClick={() => setConfirmDeleteId(null)} className="text-xs hover:underline" style={{ color: '#8b7355' }}>Cancel</button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmDeleteId(trainer.id)} className="text-sm text-red-600">Delete</button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
