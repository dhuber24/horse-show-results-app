'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

export interface AssociationOption {
  id: string;
  code: string;
  name: string;
}

export interface Judge {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  associations: { id: string; code: string; name: string }[];
  user_id: string | null;
  user_email: string | null;
  created_at: string | null;
}

interface Props {
  initialJudges: Judge[];
  associations: AssociationOption[];
}

const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--background)' } as const;
const labelStyle = { color: 'var(--text-deep)' } as const;

const emptyForm = { first_name: '', last_name: '', email: '', phone: '', association_ids: [] as string[] };
type FormState = typeof emptyForm;

function fullName(judge: Judge): string {
  return `${judge.first_name} ${judge.last_name}`.trim();
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function readError(res: Response, fallback: string): Promise<string> {
  const json = await res.json().catch(() => ({}));
  return json?.detail || json?.error || fallback;
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
      {hint && <span className="text-xs" style={{ color: 'var(--muted)' }}>{hint}</span>}
    </div>
  );
}

/** The association cards a judge holds. Points at `associations` — what a
 *  person is affiliated with — never at show types, which are show config. */
function CardPicker({
  associations,
  selected,
  onToggle,
  idPrefix,
}: {
  associations: AssociationOption[];
  selected: string[];
  onToggle: (id: string) => void;
  idPrefix: string;
}) {
  if (associations.length === 0) {
    return <p className="text-xs" style={{ color: 'var(--muted)' }}>No associations are configured.</p>;
  }
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {associations.map((association) => (
        <label
          key={association.id}
          htmlFor={`${idPrefix}-${association.id}`}
          className="flex items-center gap-2 text-sm"
          style={{ color: 'var(--text-deep)' }}
        >
          <input
            id={`${idPrefix}-${association.id}`}
            type="checkbox"
            checked={selected.includes(association.id)}
            onChange={() => onToggle(association.id)}
          />
          <span title={association.name}>{association.code}</span>
        </label>
      ))}
    </div>
  );
}

export default function JudgesManager({ initialJudges, associations }: Props) {
  const [judges, setJudges] = useState<Judge[]>(initialJudges);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm);
  const [accountFor, setAccountFor] = useState<string | null>(null);
  const [accountForm, setAccountForm] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sorted = useMemo(
    () =>
      [...judges].sort(
        (a, b) =>
          Number(b.is_active) - Number(a.is_active) ||
          a.last_name.localeCompare(b.last_name) ||
          a.first_name.localeCompare(b.first_name),
      ),
    [judges],
  );
  const activeCount = judges.filter((j) => j.is_active).length;

  const replace = (updated: Judge) =>
    setJudges((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));

  const toggleIn = (setter: React.Dispatch<React.SetStateAction<FormState>>) => (id: string) =>
    setter((prev) => ({
      ...prev,
      association_ids: prev.association_ids.includes(id)
        ? prev.association_ids.filter((a) => a !== id)
        : [...prev.association_ids, id],
    }));

  const handleCreate = async () => {
    if (!form.first_name.trim() || !form.last_name.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fetch('/api/judges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        association_ids: form.association_ids,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(await readError(res, 'Failed to add judge.'));
      return;
    }
    const created: Judge = await res.json();
    setJudges((prev) => [...prev, created]);
    setForm(emptyForm);
    setIsAdding(false);
  };

  const startEdit = (judge: Judge) => {
    setError(null);
    setNotice(null);
    setAccountFor(null);
    setEditingId(judge.id);
    setEditForm({
      first_name: judge.first_name,
      last_name: judge.last_name,
      email: judge.email ?? '',
      phone: judge.phone ?? '',
      association_ids: judge.associations.map((a) => a.id),
    });
  };

  const handleSaveEdit = async (judge: Judge) => {
    if (!editForm.first_name.trim() || !editForm.last_name.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/judges/${judge.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: editForm.first_name.trim(),
        last_name: editForm.last_name.trim(),
        email: editForm.email.trim() || null,
        phone: editForm.phone.trim() || null,
        association_ids: editForm.association_ids,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(await readError(res, 'Failed to save judge.'));
      return;
    }
    replace(await res.json());
    setEditingId(null);
  };

  const handleToggleActive = async (judge: Judge) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/judges/${judge.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !judge.is_active }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(await readError(res, 'Failed to update judge.'));
      return;
    }
    replace(await res.json());
  };

  const startAccount = (judge: Judge) => {
    setError(null);
    setNotice(null);
    setEditingId(null);
    setAccountFor(judge.id);
    setAccountForm({ email: judge.email ?? '', password: '' });
  };

  const handleCreateAccount = async (judge: Judge) => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/judges/${judge.id}/user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: accountForm.email.trim() || null,
        password: accountForm.password,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(await readError(res, 'Failed to create the account.'));
      return;
    }
    const updated: Judge = await res.json();
    replace(updated);
    setAccountFor(null);
    setAccountForm({ email: '', password: '' });
    setNotice(
      `${fullName(updated)} can now sign in as ${updated.user_email}. Pass on the password you just set — it is not shown again.`,
    );
  };

  return (
    <div className="space-y-6">
      <section className="border rounded-lg p-4 space-y-4" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>Judges</h2>
          {!isAdding && (
            <button
              onClick={() => {
                setError(null);
                setNotice(null);
                setIsAdding(true);
              }}
              className="px-4 py-2 rounded text-sm font-medium"
              style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}
            >
              Add Judge
            </button>
          )}
        </div>

        {isAdding && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FieldRow label="First name *" htmlFor="new-judge-first-name">
                <input
                  id="new-judge-first-name"
                  value={form.first_name}
                  onChange={(e) => setForm((p) => ({ ...p, first_name: e.target.value }))}
                  className="border rounded px-3 py-2 text-sm"
                  style={inputStyle}
                />
              </FieldRow>
              <FieldRow label="Last name *" htmlFor="new-judge-last-name">
                <input
                  id="new-judge-last-name"
                  value={form.last_name}
                  onChange={(e) => setForm((p) => ({ ...p, last_name: e.target.value }))}
                  className="border rounded px-3 py-2 text-sm"
                  style={inputStyle}
                />
              </FieldRow>
              <FieldRow label="Email" htmlFor="new-judge-email" hint="Identifies the judge alongside their name">
                <input
                  id="new-judge-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                  className="border rounded px-3 py-2 text-sm"
                  style={inputStyle}
                />
              </FieldRow>
              <FieldRow label="Phone" htmlFor="new-judge-phone">
                <input
                  id="new-judge-phone"
                  value={form.phone}
                  onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                  className="border rounded px-3 py-2 text-sm"
                  style={inputStyle}
                />
              </FieldRow>
            </div>
            <FieldRow
              label="Carded with"
              htmlFor="new-judge-cards"
              hint="What this app has on record. It does not make a judge approved by that association."
            >
              <div id="new-judge-cards">
                <CardPicker
                  associations={associations}
                  selected={form.association_ids}
                  onToggle={toggleIn(setForm)}
                  idPrefix="new-judge-card"
                />
              </div>
            </FieldRow>
            <div className="flex items-center gap-3">
              <button
                onClick={handleCreate}
                disabled={busy}
                className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}
              >
                {busy ? 'Adding…' : 'Add Judge'}
              </button>
              <button
                onClick={() => {
                  setForm(emptyForm);
                  setError(null);
                  setIsAdding(false);
                }}
                className="text-sm font-medium hover:underline"
                style={{ color: 'var(--muted)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {notice && (
        <p
          className="text-sm rounded border p-3"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--success-bg)', color: 'var(--text-deep)' }}
        >
          {notice}
        </p>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>
          All Judges ({sorted.length})
          {sorted.length !== activeCount && (
            <span className="ml-2 text-sm font-normal" style={{ color: 'var(--muted)' }}>
              {activeCount} active
            </span>
          )}
        </h2>
        {sorted.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>No judges yet.</p>
        ) : (
          <ul className="space-y-2">
            {sorted.map((judge) => (
              <li
                key={judge.id}
                className="border rounded p-4"
                style={{
                  borderColor: 'var(--border)',
                  backgroundColor: 'var(--surface)',
                  opacity: judge.is_active ? 1 : 0.65,
                }}
              >
                {editingId === judge.id ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <FieldRow label="First name *" htmlFor={`edit-first-${judge.id}`}>
                        <input
                          id={`edit-first-${judge.id}`}
                          value={editForm.first_name}
                          onChange={(e) => setEditForm((p) => ({ ...p, first_name: e.target.value }))}
                          className="border rounded px-3 py-2 text-sm"
                          style={inputStyle}
                        />
                      </FieldRow>
                      <FieldRow label="Last name *" htmlFor={`edit-last-${judge.id}`}>
                        <input
                          id={`edit-last-${judge.id}`}
                          value={editForm.last_name}
                          onChange={(e) => setEditForm((p) => ({ ...p, last_name: e.target.value }))}
                          className="border rounded px-3 py-2 text-sm"
                          style={inputStyle}
                        />
                      </FieldRow>
                      <FieldRow label="Email" htmlFor={`edit-email-${judge.id}`}>
                        <input
                          id={`edit-email-${judge.id}`}
                          type="email"
                          value={editForm.email}
                          onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))}
                          className="border rounded px-3 py-2 text-sm"
                          style={inputStyle}
                        />
                      </FieldRow>
                      <FieldRow label="Phone" htmlFor={`edit-phone-${judge.id}`}>
                        <input
                          id={`edit-phone-${judge.id}`}
                          value={editForm.phone}
                          onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))}
                          className="border rounded px-3 py-2 text-sm"
                          style={inputStyle}
                        />
                      </FieldRow>
                    </div>
                    <FieldRow label="Carded with" htmlFor={`edit-cards-${judge.id}`}>
                      <div id={`edit-cards-${judge.id}`}>
                        <CardPicker
                          associations={associations}
                          selected={editForm.association_ids}
                          onToggle={toggleIn(setEditForm)}
                          idPrefix={`edit-card-${judge.id}`}
                        />
                      </div>
                    </FieldRow>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleSaveEdit(judge)}
                        disabled={busy}
                        className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
                        style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}
                      >
                        {busy ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-sm font-medium hover:underline"
                        style={{ color: 'var(--muted)' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium" style={{ color: 'var(--foreground)' }}>
                        {fullName(judge)}
                        {!judge.is_active && (
                          <span className="ml-2 text-xs font-normal" style={{ color: 'var(--muted)' }}>Retired</span>
                        )}
                      </p>
                      <dl className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1" style={{ color: 'var(--text-deep)' }}>
                        <div>
                          <dt className="inline text-xs uppercase tracking-wide mr-1" style={{ color: 'var(--muted)' }}>Email:</dt>
                          <dd className="inline">{judge.email || <span style={{ color: 'var(--muted)' }}>&mdash;</span>}</dd>
                        </div>
                        <div>
                          <dt className="inline text-xs uppercase tracking-wide mr-1" style={{ color: 'var(--muted)' }}>Phone:</dt>
                          <dd className="inline">{judge.phone || <span style={{ color: 'var(--muted)' }}>&mdash;</span>}</dd>
                        </div>
                        <div title="What this app has on record — not a statement that the association has approved them.">
                          <dt className="inline text-xs uppercase tracking-wide mr-1" style={{ color: 'var(--muted)' }}>Carded with:</dt>
                          <dd className="inline">
                            {judge.associations.length > 0 ? (
                              judge.associations.map((a) => a.code).join(', ')
                            ) : (
                              <span style={{ color: 'var(--muted)' }}>None on file</span>
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline text-xs uppercase tracking-wide mr-1" style={{ color: 'var(--muted)' }}>User account:</dt>
                          <dd className="inline">
                            {judge.user_id ? (
                              <Link href={`/admin/users/${judge.user_id}`} className="underline" style={{ color: 'var(--accent)' }}>
                                {judge.user_email ?? 'View user'}
                              </Link>
                            ) : (
                              <span style={{ color: 'var(--muted)' }}>None</span>
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline text-xs uppercase tracking-wide mr-1" style={{ color: 'var(--muted)' }}>Added:</dt>
                          <dd className="inline">{formatDate(judge.created_at)}</dd>
                        </div>
                      </dl>

                      {accountFor === judge.id && (
                        <div className="mt-3 pt-3 border-t space-y-3" style={{ borderColor: 'var(--border)' }}>
                          <p className="text-xs" style={{ color: 'var(--muted)' }}>
                            Creates a Judge login for {fullName(judge)}. The name comes from this record.
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <FieldRow label="Sign-in email *" htmlFor={`account-email-${judge.id}`}>
                              <input
                                id={`account-email-${judge.id}`}
                                type="email"
                                value={accountForm.email}
                                onChange={(e) => setAccountForm((p) => ({ ...p, email: e.target.value }))}
                                className="border rounded px-3 py-2 text-sm"
                                style={inputStyle}
                              />
                            </FieldRow>
                            <FieldRow
                              label="Temporary password *"
                              htmlFor={`account-password-${judge.id}`}
                              hint="At least 8 characters. Shown once — pass it on."
                            >
                              <input
                                id={`account-password-${judge.id}`}
                                type="text"
                                autoComplete="off"
                                value={accountForm.password}
                                onChange={(e) => setAccountForm((p) => ({ ...p, password: e.target.value }))}
                                className="border rounded px-3 py-2 text-sm"
                                style={inputStyle}
                              />
                            </FieldRow>
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => handleCreateAccount(judge)}
                              disabled={busy || !accountForm.email.trim() || accountForm.password.length < 8}
                              title={
                                accountForm.password.length < 8
                                  ? 'The password must be at least 8 characters'
                                  : undefined
                              }
                              className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
                              style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}
                            >
                              {busy ? 'Creating…' : 'Create account'}
                            </button>
                            <button
                              onClick={() => setAccountFor(null)}
                              className="text-sm font-medium hover:underline"
                              style={{ color: 'var(--muted)' }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <button onClick={() => startEdit(judge)} className="text-sm font-medium underline" style={{ color: 'var(--accent)' }}>
                        Edit
                      </button>
                      {!judge.user_id && accountFor !== judge.id && (
                        <button onClick={() => startAccount(judge)} className="text-sm font-medium underline" style={{ color: 'var(--accent)' }}>
                          Create login
                        </button>
                      )}
                      <button
                        onClick={() => handleToggleActive(judge)}
                        disabled={busy}
                        title={
                          judge.is_active
                            ? 'Keeps the record and its history — show setup stops offering them'
                            : 'Puts them back on the show setup picker'
                        }
                        className="text-sm disabled:opacity-50"
                        style={{ color: judge.is_active ? 'var(--muted)' : 'var(--accent)' }}
                      >
                        {judge.is_active ? 'Retire' : 'Reinstate'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {error && <p className="text-sm" style={{ color: 'var(--error-strong)' }}>{error}</p>}
    </div>
  );
}
