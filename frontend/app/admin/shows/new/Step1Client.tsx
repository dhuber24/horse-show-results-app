'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type Venue = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
};

type ShowType = {
  id: string;
  code: string;
  name: string;
};

export type ExistingSecretary = {
  id: string;
  email: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
};

const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  border: '#d4b896',
  borderSoft: '#f0e6d2',
  bg: '#fff',
  warn: '#5c3d1e',
  warnSoft: '#fdf8eb',
} as const;

type SecretaryMode = 'pick' | 'create';

export default function Step1Client({
  callerRole,
  callerUserId,
  venues,
  showTypes,
  secretaries,
}: {
  callerRole: string;
  callerUserId: string | null;
  venues: Venue[];
  showTypes: ShowType[];
  secretaries: ExistingSecretary[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openType = useMemo(
    () => showTypes.find((t) => t.code === 'OPEN'),
    [showTypes],
  );

  const [form, setForm] = useState({
    name: '',
    show_type_id: openType?.id ?? '',
    venue_id: '',
    start_date: '',
    end_date: '',
  });

  const callerIsSecretary = callerRole === 'SHOW_SECRETARY';

  const [secretaryMode, setSecretaryMode] = useState<SecretaryMode>(
    callerIsSecretary || secretaries.length > 0 ? 'pick' : 'create',
  );
  const [secretaryUserId, setSecretaryUserId] = useState<string>(
    callerIsSecretary ? 'SELF' : '',
  );
  const [newSecretary, setNewSecretary] = useState({
    first_name: '',
    last_name: '',
    email: '',
    password: '',
  });

  function handleField<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleNewSecField<K extends keyof typeof newSecretary>(
    key: K,
    value: string,
  ) {
    setNewSecretary((prev) => ({ ...prev, [key]: value }));
  }

  function validateBasics(): string | null {
    if (!form.name.trim()) return 'Show name is required.';
    if (!form.show_type_id) return 'Show type is required.';
    if (!form.start_date) return 'Start date is required.';
    if (!form.end_date) return 'End date is required.';
    if (form.end_date < form.start_date) return 'End date must be on or after start date.';
    return null;
  }

  function validateSecretary(): string | null {
    if (callerIsSecretary && secretaryUserId === 'SELF') return null;
    if (secretaryMode === 'pick') {
      if (!secretaryUserId) return null; // skippable — but if a row is highlighted, leaving blank means skip
      return null;
    }
    if (secretaryMode === 'create') {
      const partial =
        newSecretary.first_name.trim() ||
        newSecretary.last_name.trim() ||
        newSecretary.email.trim() ||
        newSecretary.password.trim();
      if (!partial) return null; // skipped
      if (!newSecretary.first_name.trim() || !newSecretary.last_name.trim())
        return 'First and last name are required for the new secretary.';
      if (!newSecretary.email.trim()) return 'Email is required for the new secretary.';
      if (newSecretary.password.length < 8)
        return 'Secretary password must be at least 8 characters.';
    }
    return null;
  }

  async function submit() {
    const basicsError = validateBasics();
    if (basicsError) {
      setError(basicsError);
      return;
    }
    const secError = validateSecretary();
    if (secError) {
      setError(secError);
      return;
    }

    setError(null);
    setBusy(true);
    try {
      const createRes = await fetch('/api/shows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          show_type_id: form.show_type_id,
          venue_id: form.venue_id || null,
          start_date: form.start_date,
          end_date: form.end_date,
          status: 'DRAFT',
        }),
      });
      const created = await createRes.json().catch(() => null);
      if (!createRes.ok) {
        setError(created?.detail || 'Failed to create show.');
        return;
      }
      const showId: string = created.id;

      let secretaryId: string | null = null;
      if (callerIsSecretary && secretaryUserId === 'SELF') {
        secretaryId = callerUserId;
      } else if (secretaryMode === 'pick' && secretaryUserId) {
        secretaryId = secretaryUserId;
      } else if (secretaryMode === 'create') {
        const partial =
          newSecretary.first_name.trim() ||
          newSecretary.last_name.trim() ||
          newSecretary.email.trim() ||
          newSecretary.password.trim();
        if (partial) {
          const userRes = await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              first_name: newSecretary.first_name.trim(),
              last_name: newSecretary.last_name.trim(),
              email: newSecretary.email.trim(),
              password: newSecretary.password,
              role: 'SHOW_SECRETARY',
            }),
          });
          const userJson = await userRes.json().catch(() => null);
          if (!userRes.ok) {
            setError(
              `Show created, but secretary account could not be created: ${userJson?.detail || 'unknown error'}. You can assign one from the show page.`,
            );
            router.push(`/admin/shows/${showId}/setup`);
            return;
          }
          secretaryId = userJson.id;
        }
      }

      if (secretaryId) {
        const assignRes = await fetch(`/api/shows/${showId}/admins`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: secretaryId }),
        });
        if (!assignRes.ok && assignRes.status !== 409) {
          const j = await assignRes.json().catch(() => null);
          setError(
            `Show created, but secretary assignment failed: ${j?.detail || 'unknown error'}. You can assign one from the show page.`,
          );
          router.push(`/admin/shows/${showId}/setup`);
          return;
        }
      }

      router.push(`/admin/shows/${showId}/setup`);
    } finally {
      setBusy(false);
    }
  }

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

      <section
        className="p-4 rounded-lg border space-y-3"
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
      >
        <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
          Show details
        </h2>

        <Field label="Show name *">
          <input
            type="text"
            value={form.name}
            onChange={(e) => handleField('name', e.target.value)}
            className="w-full border rounded px-3 py-2"
            style={{ borderColor: COLORS.border }}
            placeholder="e.g. Spring Classic 2026"
          />
        </Field>

        <Field label="Show type *">
          <select
            value={form.show_type_id}
            onChange={(e) => handleField('show_type_id', e.target.value)}
            className="w-full border rounded px-3 py-2"
            style={{ borderColor: COLORS.border }}
          >
            <option value="">Select a show type…</option>
            {showTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.code} — {t.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Venue (optional)">
          <select
            value={form.venue_id}
            onChange={(e) => handleField('venue_id', e.target.value)}
            className="w-full border rounded px-3 py-2"
            style={{ borderColor: COLORS.border }}
          >
            <option value="">No venue selected</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.city ? `, ${v.city}` : ''}
                {v.state ? `, ${v.state}` : ''}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Start date *">
            <input
              type="date"
              value={form.start_date}
              onChange={(e) => handleField('start_date', e.target.value)}
              className="w-full border rounded px-3 py-2"
              style={{ borderColor: COLORS.border }}
            />
          </Field>
          <Field label="End date *">
            <input
              type="date"
              value={form.end_date}
              onChange={(e) => handleField('end_date', e.target.value)}
              className="w-full border rounded px-3 py-2"
              style={{ borderColor: COLORS.border }}
            />
          </Field>
        </div>
      </section>

      <section
        className="p-4 rounded-lg border space-y-3"
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
      >
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
            Show Secretary
          </h2>
          <span className="text-xs" style={{ color: COLORS.muted }}>
            Optional now — you can add or change later.
          </span>
        </div>

        {callerIsSecretary && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="sec-mode"
              checked={secretaryUserId === 'SELF'}
              onChange={() => {
                setSecretaryUserId('SELF');
                setSecretaryMode('pick');
              }}
            />
            <span style={{ color: COLORS.text }}>Assign me as the secretary.</span>
          </label>
        )}

        <div className="flex gap-2 flex-wrap">
          <ModeButton
            active={secretaryMode === 'pick' && secretaryUserId !== 'SELF'}
            onClick={() => {
              setSecretaryMode('pick');
              if (callerIsSecretary && secretaryUserId === 'SELF') {
                setSecretaryUserId('');
              }
            }}
          >
            Pick existing
          </ModeButton>
          <ModeButton
            active={secretaryMode === 'create'}
            onClick={() => {
              setSecretaryMode('create');
              if (callerIsSecretary && secretaryUserId === 'SELF') {
                setSecretaryUserId('');
              }
            }}
          >
            Create new
          </ModeButton>
        </div>

        {secretaryMode === 'pick' && secretaryUserId !== 'SELF' && (
          <Field label="Existing secretary">
            <select
              value={secretaryUserId}
              onChange={(e) => setSecretaryUserId(e.target.value)}
              className="w-full border rounded px-3 py-2"
              style={{ borderColor: COLORS.border }}
            >
              <option value="">— Skip for now —</option>
              {secretaries.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name} ({s.email})
                </option>
              ))}
            </select>
            {secretaries.length === 0 && (
              <p className="text-xs mt-1" style={{ color: COLORS.muted }}>
                No SHOW_SECRETARY accounts found. Switch to &quot;Create new&quot; to add one.
              </p>
            )}
          </Field>
        )}

        {secretaryMode === 'create' && (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="First name">
                <input
                  type="text"
                  value={newSecretary.first_name}
                  onChange={(e) => handleNewSecField('first_name', e.target.value)}
                  className="w-full border rounded px-3 py-2"
                  style={{ borderColor: COLORS.border }}
                />
              </Field>
              <Field label="Last name">
                <input
                  type="text"
                  value={newSecretary.last_name}
                  onChange={(e) => handleNewSecField('last_name', e.target.value)}
                  className="w-full border rounded px-3 py-2"
                  style={{ borderColor: COLORS.border }}
                />
              </Field>
            </div>
            <Field label="Email">
              <input
                type="email"
                value={newSecretary.email}
                onChange={(e) => handleNewSecField('email', e.target.value)}
                className="w-full border rounded px-3 py-2"
                style={{ borderColor: COLORS.border }}
                autoComplete="off"
              />
            </Field>
            <Field label="Initial password (≥ 8 chars)">
              <input
                type="password"
                value={newSecretary.password}
                onChange={(e) => handleNewSecField('password', e.target.value)}
                className="w-full border rounded px-3 py-2 font-mono"
                style={{ borderColor: COLORS.border }}
                autoComplete="new-password"
                placeholder="Share this with the secretary to log in"
              />
            </Field>
            <p className="text-xs" style={{ color: COLORS.muted }}>
              Leave all four fields blank to skip creating a secretary now.
            </p>
          </div>
        )}
      </section>

      <div
        className="p-4 rounded-lg border flex items-center justify-end gap-3 flex-wrap"
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.warnSoft }}
      >
        <button
          type="button"
          onClick={() => router.push('/admin/shows')}
          className="text-sm rounded px-3 py-2 border"
          style={{ borderColor: COLORS.border, color: COLORS.text, backgroundColor: '#fff' }}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="text-sm rounded px-4 py-2 disabled:opacity-50"
          style={{ backgroundColor: COLORS.warn, color: '#fff' }}
        >
          {busy ? 'Creating…' : 'Create show & continue →'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-sm rounded px-3 py-1.5 border"
      style={{
        borderColor: active ? COLORS.warn : COLORS.border,
        backgroundColor: active ? COLORS.warnSoft : '#fff',
        color: active ? COLORS.warn : COLORS.text,
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}
