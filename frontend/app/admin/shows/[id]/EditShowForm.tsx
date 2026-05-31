'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Venue {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
}

interface Show {
  id: string;
  name: string;
  venue: string | null;
  venue_id: string | null;
  show_type_id: string | null;
  show_type_code: string | null;
  start_date: string;
  end_date: string;
  apha_show_number: string | null;
  aqha_show_number: string | null;
  aqha_approval_status: string;
  aqha_approval_submitted_at: string | null;
  aqha_approval_notes: string | null;
}

interface ShowType {
  id: string;
  code: string;
  name: string;
}

export interface Secretary {
  id: string;
  full_name: string;
  email: string;
}

const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  border: '#d4b896',
  bg: '#fff',
  warn: '#5c3d1e',
  warnSoft: '#fdf8eb',
} as const;

export default function EditShowForm({
  show,
  venues,
  showTypes,
  initialSecretaries,
  availableSecretaries,
}: {
  show: Show;
  venues: Venue[];
  showTypes: ShowType[];
  initialSecretaries: Secretary[];
  availableSecretaries: Secretary[];
}) {
  const router = useRouter();

  const [form, setForm] = useState({
    name: show.name,
    venue_id: show.venue_id ?? '',
    show_type_id: show.show_type_id ?? '',
    start_date: show.start_date,
    end_date: show.end_date,
    apha_show_number: show.apha_show_number ?? '',
    aqha_show_number: show.aqha_show_number ?? '',
    aqha_approval_status: show.aqha_approval_status ?? 'NOT_SUBMITTED',
    aqha_approval_submitted_at: show.aqha_approval_submitted_at ?? '',
    aqha_approval_notes: show.aqha_approval_notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const selectedShowType = showTypes.find((t) => t.id === form.show_type_id);

  const handleSave = async () => {
    if (!form.name || !form.start_date || !form.end_date || !form.show_type_id) {
      setError('Name, show type, start date, and end date are required.');
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);

    const res = await fetch(`/api/shows/${show.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        venue_id: form.venue_id || null,
        show_type_id: form.show_type_id,
        start_date: form.start_date,
        end_date: form.end_date,
        apha_show_number: form.apha_show_number || null,
        aqha_show_number: form.aqha_show_number || null,
        aqha_approval_status: form.aqha_approval_status,
        aqha_approval_submitted_at: form.aqha_approval_submitted_at || null,
        aqha_approval_notes: form.aqha_approval_notes || null,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSuccess('Show details saved.');
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.detail || 'Failed to update show.');
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    const res = await fetch(`/api/shows/${show.id}`, { method: 'DELETE' });
    setDeleting(false);
    if (res.ok) {
      router.push('/admin');
    } else {
      setConfirmDelete(false);
      setError('Failed to delete show.');
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#c0392b', backgroundColor: '#fef0ef', color: '#922' }}
          role="alert"
        >
          {error}
        </div>
      )}
      {success && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#7fa97f', backgroundColor: '#eef7ee', color: '#1f4e1f' }}
        >
          {success}
        </div>
      )}

      <section
        className="p-4 rounded-lg border space-y-3"
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
      >
        <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
          Show details
        </h2>
        <input
          name="name"
          value={form.name}
          onChange={handleChange}
          className="w-full border rounded px-3 py-2"
          style={{ borderColor: COLORS.border }}
          placeholder="Show name *"
        />
        <select
          name="show_type_id"
          value={form.show_type_id}
          onChange={handleChange}
          className="w-full border rounded px-3 py-2"
          style={{ borderColor: COLORS.border }}
        >
          <option value="">Select show type *</option>
          {showTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.code} — {t.name}
            </option>
          ))}
        </select>
        <select
          name="venue_id"
          value={form.venue_id}
          onChange={handleChange}
          className="w-full border rounded px-3 py-2"
          style={{ borderColor: COLORS.border }}
        >
          <option value="">Select a venue (optional)</option>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.city ? `, ${v.city}` : ''}
              {v.state ? `, ${v.state}` : ''}
            </option>
          ))}
        </select>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
              Start date *
            </span>
            <input
              name="start_date"
              type="date"
              value={form.start_date}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
              style={{ borderColor: COLORS.border }}
            />
          </label>
          <label className="block">
            <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
              End date *
            </span>
            <input
              name="end_date"
              type="date"
              value={form.end_date}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
              style={{ borderColor: COLORS.border }}
            />
          </label>
        </div>

        {selectedShowType?.code === 'APHA' && (
          <label className="block">
            <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
              APHA Show Number
            </span>
            <input
              name="apha_show_number"
              value={form.apha_show_number}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
              style={{ borderColor: COLORS.border }}
              placeholder="e.g. 2024-TX-0042"
            />
          </label>
        )}
        {selectedShowType?.code === 'AQHA' && (
          <div
            className="border rounded p-3 space-y-3"
            style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0' }}
          >
            <label className="block">
              <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
                AQHA Show Number
              </span>
              <input
                name="aqha_show_number"
                value={form.aqha_show_number}
                onChange={handleChange}
                className="w-full border rounded px-3 py-2"
                style={{ borderColor: COLORS.border }}
                placeholder="Assigned by AQHA after approval"
              />
            </label>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
                  AQHA Approval Status
                </span>
                <select
                  name="aqha_approval_status"
                  value={form.aqha_approval_status}
                  onChange={handleChange}
                  className="w-full border rounded px-3 py-2"
                  style={{ borderColor: COLORS.border }}
                >
                  <option value="NOT_SUBMITTED">Not submitted</option>
                  <option value="SUBMITTED">Submitted</option>
                  <option value="APPROVED">Approved</option>
                  <option value="CHANGES_REQUIRED">Changes required</option>
                </select>
              </label>
              <label className="block">
                <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
                  Submitted to AQHA
                </span>
                <input
                  name="aqha_approval_submitted_at"
                  type="date"
                  value={form.aqha_approval_submitted_at}
                  onChange={handleChange}
                  className="w-full border rounded px-3 py-2"
                  style={{ borderColor: COLORS.border }}
                />
              </label>
            </div>
            <label className="block">
              <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
                AQHA Approval Notes
              </span>
              <input
                name="aqha_approval_notes"
                value={form.aqha_approval_notes}
                onChange={handleChange}
                className="w-full border rounded px-3 py-2"
                style={{ borderColor: COLORS.border }}
                placeholder="Class schedule submitted, pending correction, etc."
              />
            </label>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-sm rounded px-4 py-2 disabled:opacity-50"
            style={{ backgroundColor: COLORS.warn, color: '#fff' }}
          >
            {saving ? 'Saving…' : 'Save show details'}
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: COLORS.warn }}>
                Delete show and all its data?
              </span>
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
                style={{ color: COLORS.muted }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-sm text-red-600 hover:text-red-800"
            >
              Delete Show
            </button>
          )}
        </div>
      </section>

      <SecretarySection
        showId={show.id}
        initialSecretaries={initialSecretaries}
        availableSecretaries={availableSecretaries}
      />
    </div>
  );
}

function SecretarySection({
  showId,
  initialSecretaries,
  availableSecretaries,
}: {
  showId: string;
  initialSecretaries: Secretary[];
  availableSecretaries: Secretary[];
}) {
  const router = useRouter();
  const [secretaries, setSecretaries] = useState<Secretary[]>(initialSecretaries);
  const [unassigned, setUnassigned] = useState<Secretary[]>(
    availableSecretaries.filter((u) => !initialSecretaries.some((s) => s.id === u.id)),
  );
  const [pickId, setPickId] = useState<string>('');
  const [mode, setMode] = useState<'pick' | 'create'>('pick');
  const [newSec, setNewSec] = useState({
    first_name: '',
    last_name: '',
    email: '',
    password: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  async function addExisting() {
    if (!pickId) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/shows/${showId}/admins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: pickId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok && res.status !== 409) {
        setError(json?.detail || 'Failed to assign secretary.');
        return;
      }
      const newRow = unassigned.find((u) => u.id === pickId);
      if (newRow) {
        setSecretaries((prev) => [...prev, newRow]);
        setUnassigned((prev) => prev.filter((u) => u.id !== pickId));
      }
      setPickId('');
      setSuccess('Secretary assigned.');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function createAndAssign() {
    if (
      !newSec.first_name.trim() ||
      !newSec.last_name.trim() ||
      !newSec.email.trim() ||
      newSec.password.length < 8
    ) {
      setError('First name, last name, email, and a password of 8+ characters are required.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const userRes = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: newSec.first_name.trim(),
          last_name: newSec.last_name.trim(),
          email: newSec.email.trim(),
          password: newSec.password,
          role: 'SHOW_SECRETARY',
        }),
      });
      const userJson = await userRes.json().catch(() => null);
      if (!userRes.ok) {
        setError(userJson?.detail || 'Failed to create secretary account.');
        return;
      }
      const assignRes = await fetch(`/api/shows/${showId}/admins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userJson.id }),
      });
      if (!assignRes.ok && assignRes.status !== 409) {
        const j = await assignRes.json().catch(() => null);
        setError(j?.detail || 'Secretary created, but assigning to show failed.');
        return;
      }
      setSecretaries((prev) => [
        ...prev,
        {
          id: userJson.id,
          full_name: `${newSec.first_name.trim()} ${newSec.last_name.trim()}`,
          email: newSec.email.trim(),
        },
      ]);
      setNewSec({ first_name: '', last_name: '', email: '', password: '' });
      setMode('pick');
      setSuccess('Secretary created and assigned.');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: string) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/shows/${showId}/admins/${userId}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        const j = await res.json().catch(() => null);
        setError(j?.detail || 'Failed to remove secretary.');
        return;
      }
      const removed = secretaries.find((s) => s.id === userId);
      setSecretaries((prev) => prev.filter((s) => s.id !== userId));
      if (removed) setUnassigned((prev) => [...prev, removed]);
      setConfirmRemoveId(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="p-4 rounded-lg border space-y-3"
      style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
    >
      <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
        Show Secretary
      </h2>
      {error && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#c0392b', backgroundColor: '#fef0ef', color: '#922' }}
          role="alert"
        >
          {error}
        </div>
      )}
      {success && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#7fa97f', backgroundColor: '#eef7ee', color: '#1f4e1f' }}
        >
          {success}
        </div>
      )}

      {secretaries.length === 0 ? (
        <p className="text-sm" style={{ color: COLORS.muted }}>
          No secretary assigned yet.
        </p>
      ) : (
        <ul className="space-y-1">
          {secretaries.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 text-sm border-b pb-1"
              style={{ borderColor: '#f0e6d2' }}
            >
              <span style={{ color: COLORS.text }}>
                {s.full_name}{' '}
                <span style={{ color: COLORS.muted }}>({s.email})</span>
              </span>
              {confirmRemoveId === s.id ? (
                <span className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: COLORS.warn }}>
                    Remove?
                  </span>
                  <button
                    onClick={() => remove(s.id)}
                    disabled={busy}
                    className="text-xs text-red-600 hover:underline disabled:opacity-50"
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setConfirmRemoveId(null)}
                    className="text-xs hover:underline"
                    style={{ color: COLORS.muted }}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmRemoveId(s.id)}
                  disabled={busy}
                  className="text-xs text-red-600 hover:underline disabled:opacity-30"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2 pt-1 flex-wrap">
        <button
          type="button"
          onClick={() => setMode('pick')}
          className="text-sm rounded px-3 py-1.5 border"
          style={{
            borderColor: mode === 'pick' ? COLORS.warn : COLORS.border,
            backgroundColor: mode === 'pick' ? COLORS.warnSoft : '#fff',
            color: mode === 'pick' ? COLORS.warn : COLORS.text,
            fontWeight: mode === 'pick' ? 600 : 400,
          }}
        >
          Pick existing
        </button>
        <button
          type="button"
          onClick={() => setMode('create')}
          className="text-sm rounded px-3 py-1.5 border"
          style={{
            borderColor: mode === 'create' ? COLORS.warn : COLORS.border,
            backgroundColor: mode === 'create' ? COLORS.warnSoft : '#fff',
            color: mode === 'create' ? COLORS.warn : COLORS.text,
            fontWeight: mode === 'create' ? 600 : 400,
          }}
        >
          Create new
        </button>
      </div>

      {mode === 'pick' && (
        <div className="flex gap-2 items-center flex-wrap">
          <select
            value={pickId}
            onChange={(e) => setPickId(e.target.value)}
            className="flex-1 min-w-[12rem] border rounded px-3 py-2 text-sm"
            style={{ borderColor: COLORS.border }}
          >
            <option value="">Select a secretary…</option>
            {unassigned.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name} ({u.email})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addExisting}
            disabled={busy || !pickId}
            className="text-sm rounded px-3 py-2 disabled:opacity-50"
            style={{ backgroundColor: COLORS.warn, color: '#fff' }}
          >
            Assign
          </button>
        </div>
      )}

      {mode === 'create' && (
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <input
              type="text"
              value={newSec.first_name}
              onChange={(e) => setNewSec((p) => ({ ...p, first_name: e.target.value }))}
              placeholder="First name"
              className="w-full border rounded px-3 py-2 text-sm"
              style={{ borderColor: COLORS.border }}
            />
            <input
              type="text"
              value={newSec.last_name}
              onChange={(e) => setNewSec((p) => ({ ...p, last_name: e.target.value }))}
              placeholder="Last name"
              className="w-full border rounded px-3 py-2 text-sm"
              style={{ borderColor: COLORS.border }}
            />
          </div>
          <input
            type="email"
            value={newSec.email}
            onChange={(e) => setNewSec((p) => ({ ...p, email: e.target.value }))}
            placeholder="Email"
            autoComplete="off"
            className="w-full border rounded px-3 py-2 text-sm"
            style={{ borderColor: COLORS.border }}
          />
          <input
            type="password"
            value={newSec.password}
            onChange={(e) => setNewSec((p) => ({ ...p, password: e.target.value }))}
            placeholder="Initial password (≥ 8 chars)"
            autoComplete="new-password"
            className="w-full border rounded px-3 py-2 text-sm font-mono"
            style={{ borderColor: COLORS.border }}
          />
          <button
            type="button"
            onClick={createAndAssign}
            disabled={busy}
            className="text-sm rounded px-3 py-2 disabled:opacity-50"
            style={{ backgroundColor: COLORS.warn, color: '#fff' }}
          >
            Create & assign
          </button>
        </div>
      )}
    </section>
  );
}
