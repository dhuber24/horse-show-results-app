'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

interface Trainer {
  id: string;
  user_id: string | null;
  name: string;
  private_phone: string | null;
  phone: string | null;
  email: string | null;
  user_email: string | null;
  horse_count: number;
  created_at: string;
}

interface FormState {
  name: string;
  private_phone: string;
  phone: string;
  email: string;
}

interface Props {
  initialTrainers: Trainer[];
}

const emptyForm: FormState = { name: '', private_phone: '', phone: '', email: '' };

const inputStyle = { borderColor: '#d4b896', backgroundColor: '#faf7f2' } as const;
const labelStyle = { color: '#5a4632' } as const;

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function FieldRow({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium uppercase tracking-wide" style={labelStyle}>
        {label}
      </label>
      {children}
      {hint && <span className="text-xs" style={{ color: '#8b7355' }}>{hint}</span>}
    </div>
  );
}

export default function TrainersManager({ initialTrainers }: Props) {
  const [trainers, setTrainers] = useState<Trainer[]>(initialTrainers);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm);
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
        private_phone: form.private_phone.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to add trainer.');
      return;
    }
    const created: Trainer = await res.json();
    setTrainers((prev) => [...prev, created]);
    setForm(emptyForm);
  };

  const startEdit = (trainer: Trainer) => {
    setEditingId(trainer.id);
    setEditForm({
      name: trainer.name,
      private_phone: trainer.private_phone ?? '',
      phone: trainer.phone ?? '',
      email: trainer.email ?? '',
    });
    setError(null);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editForm.name.trim()) return;
    const res = await fetch(`/api/trainers/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editForm.name.trim(),
        private_phone: editForm.private_phone.trim() || null,
        phone: editForm.phone.trim() || null,
        email: editForm.email.trim() || null,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to update trainer.');
      return;
    }
    const updated: Trainer = await res.json();
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
      <section className="border rounded-lg p-4 space-y-4" style={{ borderColor: '#d4b896' }}>
        <h2 className="font-semibold" style={{ color: '#2c1810' }}>Add Trainer</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FieldRow label="Name *" htmlFor="new-trainer-name">
            <input id="new-trainer-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} className="border rounded px-3 py-2 text-sm" style={inputStyle} />
          </FieldRow>
          <FieldRow label="Private phone" htmlFor="new-trainer-private-phone" hint="Internal contact, not shown publicly">
            <input id="new-trainer-private-phone" value={form.private_phone} onChange={(e) => setForm((p) => ({ ...p, private_phone: e.target.value }))} className="border rounded px-3 py-2 text-sm" style={inputStyle} />
          </FieldRow>
          <FieldRow label="Public phone" htmlFor="new-trainer-phone">
            <input id="new-trainer-phone" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} className="border rounded px-3 py-2 text-sm" style={inputStyle} />
          </FieldRow>
          <FieldRow label="Public email" htmlFor="new-trainer-email">
            <input id="new-trainer-email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} className="border rounded px-3 py-2 text-sm" style={inputStyle} />
          </FieldRow>
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
              <li key={trainer.id} className="border rounded p-4" style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}>
                {editingId === trainer.id ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <FieldRow label="Name *" htmlFor={`edit-name-${trainer.id}`}>
                        <input id={`edit-name-${trainer.id}`} value={editForm.name} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} className="border rounded px-3 py-2 text-sm" style={inputStyle} />
                      </FieldRow>
                      <FieldRow label="Private phone" htmlFor={`edit-private-phone-${trainer.id}`} hint="Internal contact, not shown publicly">
                        <input id={`edit-private-phone-${trainer.id}`} value={editForm.private_phone} onChange={(e) => setEditForm((p) => ({ ...p, private_phone: e.target.value }))} className="border rounded px-3 py-2 text-sm" style={inputStyle} />
                      </FieldRow>
                      <FieldRow label="Public phone" htmlFor={`edit-phone-${trainer.id}`}>
                        <input id={`edit-phone-${trainer.id}`} value={editForm.phone} onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))} className="border rounded px-3 py-2 text-sm" style={inputStyle} />
                      </FieldRow>
                      <FieldRow label="Public email" htmlFor={`edit-email-${trainer.id}`}>
                        <input id={`edit-email-${trainer.id}`} value={editForm.email} onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))} className="border rounded px-3 py-2 text-sm" style={inputStyle} />
                      </FieldRow>
                    </div>
                    <div className="flex gap-3">
                      <button onClick={handleSaveEdit} className="text-sm font-medium" style={{ color: '#8b4513' }}>Save</button>
                      <button onClick={() => { setEditingId(null); setEditForm(emptyForm); }} className="text-sm" style={{ color: '#8b7355' }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium" style={{ color: '#2c1810' }}>{trainer.name}</p>
                      <dl className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1" style={{ color: '#5a4632' }}>
                        <div>
                          <dt className="inline text-xs uppercase tracking-wide mr-1" style={{ color: '#8b7355' }}>Public phone:</dt>
                          <dd className="inline">{trainer.phone || <span style={{ color: '#8b7355' }}>—</span>}</dd>
                        </div>
                        <div>
                          <dt className="inline text-xs uppercase tracking-wide mr-1" style={{ color: '#8b7355' }}>Public email:</dt>
                          <dd className="inline">{trainer.email || <span style={{ color: '#8b7355' }}>—</span>}</dd>
                        </div>
                        <div>
                          <dt className="inline text-xs uppercase tracking-wide mr-1" style={{ color: '#8b7355' }}>Private phone:</dt>
                          <dd className="inline">{trainer.private_phone || <span style={{ color: '#8b7355' }}>—</span>}</dd>
                        </div>
                        <div>
                          <dt className="inline text-xs uppercase tracking-wide mr-1" style={{ color: '#8b7355' }}>User account:</dt>
                          <dd className="inline">
                            {trainer.user_id ? (
                              <Link href={`/admin/users/${trainer.user_id}`} className="underline" style={{ color: '#8b4513' }}>
                                {trainer.user_email ?? 'View user'}
                              </Link>
                            ) : (
                              <span style={{ color: '#8b7355' }}>Not linked</span>
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline text-xs uppercase tracking-wide mr-1" style={{ color: '#8b7355' }}>Horses:</dt>
                          <dd className="inline">{trainer.horse_count}</dd>
                        </div>
                        <div>
                          <dt className="inline text-xs uppercase tracking-wide mr-1" style={{ color: '#8b7355' }}>Created:</dt>
                          <dd className="inline">{formatDate(trainer.created_at)}</dd>
                        </div>
                      </dl>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
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
