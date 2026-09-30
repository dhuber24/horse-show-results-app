'use client';

import { useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';

type User = { id: string; full_name: string; email: string; role: string };

export type PendingInvite = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  expires_at: string;
};

type Props = {
  showId: string;
  initialScribes: User[];
  initialGateStewards?: User[];
  allUsers: User[];
  isAdmin: boolean;
  initialPendingInvites?: PendingInvite[];
};

const emptyInviteForm = { first_name: '', last_name: '', email: '' };

/**
 * The staff hired for one show: scribes and gate stewards. Managers and
 * secretaries come from the company that runs the show (`ShowCompanyStaff`,
 * migration 156); these two roles are staffed show by show and are not
 * company members.
 */
export default function ShowStaffPanel({
  showId,
  initialScribes,
  initialGateStewards = [],
  allUsers,
  isAdmin,
  initialPendingInvites = [],
}: Props) {
  const [scribes, setScribes] = useState<User[]>(initialScribes);
  const [gateStewards, setGateStewards] = useState<User[]>(initialGateStewards);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>(initialPendingInvites);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [confirmRemoveScribeId, setConfirmRemoveScribeId] = useState<string | null>(null);
  const [confirmRemoveStewardId, setConfirmRemoveStewardId] = useState<string | null>(null);

  const [showAssignForm, setShowAssignForm] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [showAssignStewardForm, setShowAssignStewardForm] = useState(false);
  const [showInviteStewardForm, setShowInviteStewardForm] = useState(false);
  const [inviteForm, setInviteForm] = useState(emptyInviteForm);
  const [stewardInviteForm, setStewardInviteForm] = useState(emptyInviteForm);
  const [stewardInviteError, setStewardInviteError] = useState('');
  const [selectedStewardId, setSelectedStewardId] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [lastInviteUrl, setLastInviteUrl] = useState<{ name: string; url: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [selectedScribeId, setSelectedScribeId] = useState('');

  const availableScribes = allUsers.filter(
    u => u.role === 'SCRIBE' && !scribes.find(s => s.id === u.id)
  );
  const availableGateStewards = allUsers.filter(
    u => u.role === 'GATE_STEWARD' && !gateStewards.find(s => s.id === u.id)
  );
  const scribeInvites = pendingInvites.filter(i => i.role === 'SCRIBE');
  const stewardInvites = pendingInvites.filter(i => i.role === 'GATE_STEWARD');

  async function addScribe(userId: string) {
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`/api/shows/${showId}/scribes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.detail || 'Failed to add scribe'); return; }
      setScribes(prev => [...prev, json]);
    } finally { setBusy(false); }
  }

  async function removeScribe(userId: string) {
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`/api/shows/${showId}/scribes/${userId}`, { method: 'DELETE' });
      if (!res.ok) { const j = await res.json(); setError(j.detail || 'Failed'); return; }
      setScribes(prev => prev.filter(s => s.id !== userId));
    } finally { setBusy(false); }
  }

  async function addGateSteward(userId: string) {
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`/api/shows/${showId}/gate-stewards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.detail || 'Failed to add gate steward'); return; }
      setGateStewards(prev => [...prev, json]);
    } finally { setBusy(false); }
  }

  async function removeGateSteward(userId: string) {
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`/api/shows/${showId}/gate-stewards/${userId}`, { method: 'DELETE' });
      if (!res.ok) { const j = await res.json(); setError(j.detail || 'Failed'); return; }
      setGateStewards(prev => prev.filter(s => s.id !== userId));
    } finally { setBusy(false); }
  }

  async function sendStewardInvite(e: React.FormEvent) {
    e.preventDefault();
    setStewardInviteError('');
    setBusy(true);
    try {
      const res = await fetch('/api/user-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: stewardInviteForm.first_name.trim(),
          last_name: stewardInviteForm.last_name.trim(),
          email: stewardInviteForm.email.trim(),
          role: 'GATE_STEWARD',
          show_id: showId,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setStewardInviteError(json?.detail || 'Failed to send invite.');
        return;
      }
      const fullName = `${json.first_name} ${json.last_name}`;
      setPendingInvites(prev => [
        {
          id: json.id,
          email: json.email,
          first_name: json.first_name,
          last_name: json.last_name,
          role: json.role,
          expires_at: json.expires_at,
        },
        ...prev,
      ]);
      setLastInviteUrl({ name: fullName, url: json.accept_url });
      setStewardInviteForm(emptyInviteForm);
      setShowInviteStewardForm(false);
    } finally {
      setBusy(false);
    }
  }

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError('');
    setBusy(true);
    try {
      const res = await fetch('/api/user-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: inviteForm.first_name.trim(),
          last_name: inviteForm.last_name.trim(),
          email: inviteForm.email.trim(),
          role: 'SCRIBE',
          show_id: showId,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setInviteError(json?.detail || 'Failed to send invite.');
        return;
      }
      const fullName = `${json.first_name} ${json.last_name}`;
      setPendingInvites(prev => [
        {
          id: json.id,
          email: json.email,
          first_name: json.first_name,
          last_name: json.last_name,
          role: json.role,
          expires_at: json.expires_at,
        },
        ...prev,
      ]);
      setLastInviteUrl({ name: fullName, url: json.accept_url });
      setInviteForm(emptyInviteForm);
      setShowInviteForm(false);
    } finally {
      setBusy(false);
    }
  }

  async function cancelInvite(inviteId: string) {
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`/api/user-invites/${inviteId}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const j = await res.json().catch(() => null);
        setError(j?.detail || 'Failed to cancel invite.');
        return;
      }
      setPendingInvites(prev => prev.filter(i => i.id !== inviteId));
    } finally {
      setBusy(false);
    }
  }

  async function copyToClipboard(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(current => (current === key ? null : current)), 1500);
    } catch {
      // Clipboard API can fail in non-secure contexts; user can still
      // select and copy the URL from the display field.
    }
  }

  const inputClass = "border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1";
  const inputStyle = { borderColor: 'var(--border)' };

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {lastInviteUrl && (
        <div
          className="rounded border p-3 space-y-2"
          style={{ borderColor: 'var(--success-border)', backgroundColor: 'var(--success-bg)' }}
        >
          <p className="text-sm" style={{ color: 'var(--success-strong)' }}>
            Invite for <strong>{lastInviteUrl.name}</strong> created. Share this
            link until email delivery is configured:
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={lastInviteUrl.url}
              className="flex-1 border rounded px-2 py-1 text-xs font-mono"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              onClick={() => copyToClipboard('last', lastInviteUrl.url)}
              className="text-xs px-2 py-1 rounded border"
              style={{ borderColor: 'var(--success-border)', color: 'var(--success-strong)', backgroundColor: 'var(--surface)' }}
            >
              {copiedKey === 'last' ? 'Copied!' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={() => setLastInviteUrl(null)}
              className="text-xs px-2 py-1 hover:underline"
              style={{ color: 'var(--success-strong)' }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <section className="p-5 rounded-lg border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
        <h2 className="text-base font-semibold mb-3" style={{ color: 'var(--foreground)' }}>Scribes</h2>

        {scribes.length === 0 && (
          <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>No scribes assigned.</p>
        )}
        <ul className="space-y-1 mb-4">
          {scribes.map(s => (
            <li key={s.id} className="flex items-center justify-between text-sm py-1 gap-2">
              <span style={{ color: 'var(--foreground)' }}>{s.full_name} <span style={{ color: 'var(--muted)' }}>({s.email})</span></span>
              <button disabled={busy} onClick={() => setConfirmRemoveScribeId(s.id)}
                className="text-xs text-red-600 hover:underline disabled:opacity-50 shrink-0">
                Remove
              </button>
            </li>
          ))}
        </ul>

        {confirmRemoveScribeId && (
          <ConfirmDialog
            title="Remove Scribe"
            message={`Remove ${scribes.find(s => s.id === confirmRemoveScribeId)?.full_name} as a scribe? This cannot be undone.`}
            confirmLabel="Yes, remove"
            destructive
            confirming={busy}
            onConfirm={async () => {
              await removeScribe(confirmRemoveScribeId);
              setConfirmRemoveScribeId(null);
            }}
            onCancel={() => setConfirmRemoveScribeId(null)}
          />
        )}

        {scribeInvites.length > 0 && (
          <div
            className="rounded border p-3 mb-3 space-y-2"
            style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--warning-bg)' }}
          >
            <p className="text-xs font-medium" style={{ color: 'var(--text-deep)' }}>
              Pending scribe invites
            </p>
            <ul className="space-y-1">
              {scribeInvites.map((inv) => (
                <li
                  key={inv.id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span style={{ color: 'var(--foreground)' }}>
                    {inv.first_name} {inv.last_name}{' '}
                    <span style={{ color: 'var(--muted)' }}>({inv.email})</span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => cancelInvite(inv.id)}
                    className="text-xs text-red-600 hover:underline disabled:opacity-50 shrink-0"
                  >
                    Cancel
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Assign / invite — collapsed behind buttons */}
        {!showAssignForm && !showInviteForm && (
          <div className="flex flex-wrap gap-3">
            {isAdmin && availableScribes.length > 0 && (
              <button onClick={() => setShowAssignForm(true)}
                className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
                + Assign existing scribe
              </button>
            )}
            <button onClick={() => setShowInviteForm(true)}
              className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
              + Invite a scribe
            </button>
          </div>
        )}

        {/* Assign existing scribe — ADMIN only */}
        {isAdmin && showAssignForm && (
          <div className="flex items-center gap-2 mb-3">
            <select value={selectedScribeId} onChange={(e) => setSelectedScribeId(e.target.value)} className={`${inputClass} flex-1`} style={inputStyle}>
              <option value="" disabled>Select a scribe…</option>
              {availableScribes.map(u => (
                <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>
              ))}
            </select>
            <button disabled={busy}
              onClick={() => { if (selectedScribeId) { addScribe(selectedScribeId); setSelectedScribeId(''); setShowAssignForm(false); } }}
              className="px-3 py-1 rounded text-sm text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)' }}>
              {busy ? 'Assigning…' : 'Assign'}
            </button>
            <button type="button" onClick={() => { setShowAssignForm(false); setSelectedScribeId(''); }}
              className="px-3 py-1 rounded text-sm border" style={{ borderColor: 'var(--border)', color: 'var(--text-deep)' }}>
              Cancel
            </button>
          </div>
        )}

        {/* Invite a scribe — first/last/email only; backend issues a token */}
        {showInviteForm && (
          <form onSubmit={sendInvite} className="mt-3 space-y-3">
            <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
              Invite a Scribe
            </p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              We&apos;ll generate an invite link. The scribe opens the link,
              picks a password, and lands ready to score this show.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-deep)' }}>First Name</label>
                <input
                  required
                  className={`${inputClass} w-full`}
                  style={inputStyle}
                  value={inviteForm.first_name}
                  onChange={e => setInviteForm(f => ({ ...f, first_name: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-deep)' }}>Last Name</label>
                <input
                  required
                  className={`${inputClass} w-full`}
                  style={inputStyle}
                  value={inviteForm.last_name}
                  onChange={e => setInviteForm(f => ({ ...f, last_name: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-deep)' }}>Email</label>
              <input
                required
                type="email"
                className={`${inputClass} w-full`}
                style={inputStyle}
                value={inviteForm.email}
                onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))}
                autoComplete="off"
              />
            </div>
            {inviteError && <p className="text-xs text-red-600">{inviteError}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy}
                className="px-3 py-1 rounded text-sm text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                {busy ? 'Sending…' : 'Send invite'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowInviteForm(false);
                  setInviteForm(emptyInviteForm);
                  setInviteError('');
                }}
                className="px-3 py-1 rounded text-sm border"
                style={{ borderColor: 'var(--border)', color: 'var(--text-deep)' }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="p-5 rounded-lg border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
        <h2 className="text-base font-semibold mb-1" style={{ color: 'var(--foreground)' }}>Gate Stewards</h2>
        <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
          Manage the warm-up side of the in-gate: order-of-go and who enters the ring next.
        </p>

        {gateStewards.length === 0 && (
          <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>No gate stewards assigned.</p>
        )}
        <ul className="space-y-1 mb-4">
          {gateStewards.map(s => (
            <li key={s.id} className="flex items-center justify-between text-sm py-1 gap-2">
              <span style={{ color: 'var(--foreground)' }}>{s.full_name} <span style={{ color: 'var(--muted)' }}>({s.email})</span></span>
              <button disabled={busy} onClick={() => setConfirmRemoveStewardId(s.id)}
                className="text-xs text-red-600 hover:underline disabled:opacity-50 shrink-0">
                Remove
              </button>
            </li>
          ))}
        </ul>

        {confirmRemoveStewardId && (
          <ConfirmDialog
            title="Remove Gate Steward"
            message={`Remove ${gateStewards.find(s => s.id === confirmRemoveStewardId)?.full_name} as a gate steward? This cannot be undone.`}
            confirmLabel="Yes, remove"
            destructive
            confirming={busy}
            onConfirm={async () => {
              await removeGateSteward(confirmRemoveStewardId);
              setConfirmRemoveStewardId(null);
            }}
            onCancel={() => setConfirmRemoveStewardId(null)}
          />
        )}

        {stewardInvites.length > 0 && (
          <div
            className="rounded border p-3 mb-3 space-y-2"
            style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--warning-bg)' }}
          >
            <p className="text-xs font-medium" style={{ color: 'var(--text-deep)' }}>
              Pending gate steward invites
            </p>
            <ul className="space-y-1">
              {stewardInvites.map((inv) => (
                <li
                  key={inv.id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span style={{ color: 'var(--foreground)' }}>
                    {inv.first_name} {inv.last_name}{' '}
                    <span style={{ color: 'var(--muted)' }}>({inv.email})</span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => cancelInvite(inv.id)}
                    className="text-xs text-red-600 hover:underline disabled:opacity-50 shrink-0"
                  >
                    Cancel
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!showAssignStewardForm && !showInviteStewardForm && (
          <div className="flex flex-wrap gap-3">
            {isAdmin && availableGateStewards.length > 0 && (
              <button onClick={() => setShowAssignStewardForm(true)}
                className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
                + Assign existing gate steward
              </button>
            )}
            <button onClick={() => setShowInviteStewardForm(true)}
              className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
              + Invite a gate steward
            </button>
          </div>
        )}

        {isAdmin && showAssignStewardForm && (
          <div className="flex items-center gap-2 mb-3">
            <select value={selectedStewardId} onChange={(e) => setSelectedStewardId(e.target.value)} className={`${inputClass} flex-1`} style={inputStyle}>
              <option value="" disabled>Select a gate steward…</option>
              {availableGateStewards.map(u => (
                <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>
              ))}
            </select>
            <button disabled={busy}
              onClick={() => { if (selectedStewardId) { addGateSteward(selectedStewardId); setSelectedStewardId(''); setShowAssignStewardForm(false); } }}
              className="px-3 py-1 rounded text-sm text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)' }}>
              {busy ? 'Assigning…' : 'Assign'}
            </button>
            <button type="button" onClick={() => { setShowAssignStewardForm(false); setSelectedStewardId(''); }}
              className="px-3 py-1 rounded text-sm border" style={{ borderColor: 'var(--border)', color: 'var(--text-deep)' }}>
              Cancel
            </button>
          </div>
        )}

        {showInviteStewardForm && (
          <form onSubmit={sendStewardInvite} className="mt-3 space-y-3">
            <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
              Invite a Gate Steward
            </p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              We&apos;ll generate an invite link. The gate steward opens the link,
              picks a password, and lands ready to run the gate for this show.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-deep)' }}>First Name</label>
                <input
                  required
                  className={`${inputClass} w-full`}
                  style={inputStyle}
                  value={stewardInviteForm.first_name}
                  onChange={e => setStewardInviteForm(f => ({ ...f, first_name: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-deep)' }}>Last Name</label>
                <input
                  required
                  className={`${inputClass} w-full`}
                  style={inputStyle}
                  value={stewardInviteForm.last_name}
                  onChange={e => setStewardInviteForm(f => ({ ...f, last_name: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-deep)' }}>Email</label>
              <input
                required
                type="email"
                className={`${inputClass} w-full`}
                style={inputStyle}
                value={stewardInviteForm.email}
                onChange={e => setStewardInviteForm(f => ({ ...f, email: e.target.value }))}
                autoComplete="off"
              />
            </div>
            {stewardInviteError && <p className="text-xs text-red-600">{stewardInviteError}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy}
                className="px-3 py-1 rounded text-sm text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                {busy ? 'Sending…' : 'Send invite'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowInviteStewardForm(false);
                  setStewardInviteForm(emptyInviteForm);
                  setStewardInviteError('');
                }}
                className="px-3 py-1 rounded text-sm border"
                style={{ borderColor: 'var(--border)', color: 'var(--text-deep)' }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
