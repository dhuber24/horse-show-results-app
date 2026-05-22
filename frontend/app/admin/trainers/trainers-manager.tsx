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
  first_name: string;
  last_name: string;
  private_phone: string;
  phone: string;
  email: string;
}

interface Props {
  initialTrainers: Trainer[];
}

const emptyForm: FormState = { first_name: '', last_name: '', private_phone: '', phone: '', email: '' };

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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sorted = useMemo(() => [...trainers].sort((a, b) => a.name.localeCompare(b.name)), [trainers]);

  const handleCreate = async () => {
    if (!form.first_name.trim() || !form.last_name.trim()) return;
    setError(null);
    const res = await fetch('/api/trainers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
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
          <FieldRow label="First name *" htmlFor="new-trainer-first-name">
            <input id="new-trainer-first-name" value={form.first_name} onChange={(e) => setForm((p) => ({ ...p, first_name: e.target.value }))} className="border rounded px-3 py-2 text-sm" style={inputStyle} />
          </FieldRow>
          <FieldRow label="Last name *" htmlFor="new-trainer-last-name">
            <input id="new-trainer-last-name" value={form.last_name} onChange={(e) => setForm((p) => ({ ...p, last_name: e.target.value }))} className="border rounded px-3 py-2 text-sm" style={inputStyle} />
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
                    <Link href={`/admin/trainers/${trainer.id}`} className="text-sm font-medium underline" style={{ color: '#8b4513' }}>
                      Manage
                    </Link>
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
              </li>
            ))}
          </ul>
        )}
      </section>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
