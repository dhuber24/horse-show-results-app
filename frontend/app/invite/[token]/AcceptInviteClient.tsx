'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  border: '#d4b896',
  bg: '#fff',
  warn: '#5c3d1e',
} as const;

export default function AcceptInviteClient({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/user-invites/by-token/${encodeURIComponent(token)}/accept`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        },
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.detail || 'Failed to accept invite.');
        return;
      }
      setDone(true);
      setTimeout(() => router.push('/login?invited=1'), 1500);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div
        className="rounded border px-3 py-3 text-sm"
        style={{ borderColor: '#7fa97f', backgroundColor: '#eef7ee', color: '#1f4e1f' }}
      >
        Account created. Redirecting you to sign in…
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#c0392b', backgroundColor: '#fef0ef', color: '#922' }}
          role="alert"
        >
          {error}
        </div>
      )}
      <label className="block">
        <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
          Choose a password (≥ 8 chars)
        </span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border rounded px-3 py-2 font-mono"
          style={{ borderColor: COLORS.border }}
          autoComplete="new-password"
          required
        />
      </label>
      <label className="block">
        <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
          Confirm password
        </span>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full border rounded px-3 py-2 font-mono"
          style={{ borderColor: COLORS.border }}
          autoComplete="new-password"
          required
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="text-sm rounded px-4 py-2 disabled:opacity-50"
        style={{ backgroundColor: COLORS.warn, color: '#fff' }}
      >
        {busy ? 'Creating account…' : 'Accept invite & create account'}
      </button>
    </form>
  );
}
