'use client';

import { useState } from 'react';

type User = { id: string; full_name: string; email: string; role: string };

type Props = {
  showId: string;
  currentUserRole: string;
  initialAdmins: User[];
  initialScorekeepers: User[];
  allUsers: User[];
  isAdmin: boolean;
};

const emptyForm = { full_name: '', email: '', password: '' };

export default function ShowStaffPanel({
  showId,
  initialAdmins,
  initialScorekeepers,
  allUsers,
  isAdmin,
}: Props) {
  const [admins, setAdmins] = useState<User[]>(initialAdmins);
  const [scorekeepers, setScorekeepers] = useState<User[]>(initialScorekeepers);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState(emptyForm);
  const [createError, setCreateError] = useState('');
  const [createSuccess, setCreateSuccess] = useState('');

  const availableShowAdmins = allUsers.filter(
    u => u.role === 'SHOW_ADMIN' && !admins.find(a => a.id === u.id)
  );
  const availableScorekeepers = allUsers.filter(
    u => u.role === 'SCOREKEEPER' && !scorekeepers.find(s => s.id === u.id)
  );

  async function addAdmin(userId: string) {
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`/api/shows/${showId}/admins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.detail || 'Failed to add admin'); return; }
      setAdmins(prev => [...prev, json]);
    } finally { setBusy(false); }
  }

  async function removeAdmin(userId: string) {
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`/api/shows/${showId}/admins/${userId}`, { method: 'DELETE' });
      if (!res.ok) { const j = await res.json(); setError(j.detail || 'Failed'); return; }
      setAdmins(prev => prev.filter(a => a.id !== userId));
    } finally { setBusy(false); }
  }

  async function addScorekeeper(userId: string) {
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`/api/shows/${showId}/scorekeepers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.detail || 'Failed to add scorekeeper'); return; }
      setScorekeepers(prev => [...prev, json]);
    } finally { setBusy(false); }
  }

  async function removeScorekeeper(userId: string) {
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`/api/shows/${showId}/scorekeepers/${userId}`, { method: 'DELETE' });
      if (!res.ok) { const j = await res.json(); setError(j.detail || 'Failed'); return; }
      setScorekeepers(prev => prev.filter(s => s.id !== userId));
    } finally { setBusy(false); }
  }

  async function createAndAssignScorekeeper(e: React.FormEvent) {
    e.preventDefault();
    setCreateError('');
    setCreateSuccess('');
    setBusy(true);
    try {
      // Create the scorekeeper account
      const createRes = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...createForm, role: 'SCOREKEEPER' }),
      });
      const newUser = await createRes.json();
      if (!createRes.ok) { setCreateError(newUser.detail || 'Failed to create scorekeeper'); return; }

      // Assign them to this show
      const assignRes = await fetch(`/api/shows/${showId}/scorekeepers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: newUser.id }),
      });
      if (!assignRes.ok) {
        const j = await assignRes.json();
        setCreateError(j.detail || 'Created user but failed to assign to show');
        return;
      }

      setScorekeepers(prev => [...prev, newUser]);
      setCreateSuccess(`${newUser.full_name} created and assigned.`);
      setCreateForm(emptyForm);
      setShowCreateForm(false);
    } finally { setBusy(false); }
  }

  const inputClass = "border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1";
  const inputStyle = { borderColor: '#d4b896' };

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {isAdmin && (
        <section className="p-5 rounded-lg border" style={{ borderColor: '#d4b896', backgroundColor: '#fff' }}>
          <h2 className="text-base font-semibold mb-3" style={{ color: '#2c1810' }}>Show Admins</h2>

          {admins.length === 0 && (
            <p className="text-sm mb-3" style={{ color: '#8b7355' }}>No show admins assigned.</p>
          )}
          <ul className="space-y-1 mb-4">
            {admins.map(a => (
              <li key={a.id} className="flex items-center justify-between text-sm py-1">
                <span style={{ color: '#2c1810' }}>{a.full_name} <span style={{ color: '#8b7355' }}>({a.email})</span></span>
                <button disabled={busy} onClick={() => removeAdmin(a.id)}
                  className="text-xs text-red-600 hover:underline disabled:opacity-50">
                  Remove
                </button>
              </li>
            ))}
          </ul>

          {availableShowAdmins.length > 0 ? (
            <div className="flex items-center gap-2">
              <select id="add-admin-select" className={`${inputClass} flex-1`} style={inputStyle} defaultValue="">
                <option value="" disabled>Select a Show Admin to add…</option>
                {availableShowAdmins.map(u => (
                  <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>
                ))}
              </select>
              <button disabled={busy}
                onClick={() => { const s = document.getElementById('add-admin-select') as HTMLSelectElement; if (s.value) addAdmin(s.value); }}
                className="px-3 py-1 rounded text-sm text-white disabled:opacity-50"
                style={{ backgroundColor: '#8b4513' }}>
                Add
              </button>
            </div>
          ) : (
            <p className="text-xs" style={{ color: '#8b7355' }}>
              No additional Show Admins available. Create one in{' '}
              <a href="/admin/users" className="underline">User Management</a>.
            </p>
          )}
        </section>
      )}

      <section className="p-5 rounded-lg border" style={{ borderColor: '#d4b896', backgroundColor: '#fff' }}>
        <h2 className="text-base font-semibold mb-3" style={{ color: '#2c1810' }}>Scorekeepers</h2>

        {scorekeepers.length === 0 && (
          <p className="text-sm mb-3" style={{ color: '#8b7355' }}>No scorekeepers assigned.</p>
        )}
        <ul className="space-y-1 mb-4">
          {scorekeepers.map(s => (
            <li key={s.id} className="flex items-center justify-between text-sm py-1">
              <span style={{ color: '#2c1810' }}>{s.full_name} <span style={{ color: '#8b7355' }}>({s.email})</span></span>
              <button disabled={busy} onClick={() => removeScorekeeper(s.id)}
                className="text-xs text-red-600 hover:underline disabled:opacity-50">
                Remove
              </button>
            </li>
          ))}
        </ul>

        {createSuccess && <p className="text-sm text-green-700 mb-3">{createSuccess}</p>}

        {/* Assign existing scorekeeper — ADMIN only */}
        {isAdmin && availableScorekeepers.length > 0 && (
          <div className="flex items-center gap-2 mb-3">
            <select id="add-keeper-select" className={`${inputClass} flex-1`} style={inputStyle} defaultValue="">
              <option value="" disabled>Assign existing scorekeeper…</option>
              {availableScorekeepers.map(u => (
                <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>
              ))}
            </select>
            <button disabled={busy}
              onClick={() => { const s = document.getElementById('add-keeper-select') as HTMLSelectElement; if (s.value) addScorekeeper(s.value); }}
              className="px-3 py-1 rounded text-sm text-white disabled:opacity-50"
              style={{ backgroundColor: '#8b4513' }}>
              Assign
            </button>
          </div>
        )}

        {/* Create new scorekeeper */}
        {!showCreateForm ? (
          <button onClick={() => setShowCreateForm(true)}
            className="text-sm hover:underline" style={{ color: '#8b4513' }}>
            + Create new scorekeeper
          </button>
        ) : (
          <form onSubmit={createAndAssignScorekeeper} className="mt-3 space-y-3">
            <p className="text-sm font-medium" style={{ color: '#2c1810' }}>New Scorekeeper</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: '#5a3e2b' }}>Full Name</label>
                <input required className={`${inputClass} w-full`} style={inputStyle}
                  value={createForm.full_name}
                  onChange={e => setCreateForm(f => ({ ...f, full_name: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: '#5a3e2b' }}>Email</label>
                <input required type="email" className={`${inputClass} w-full`} style={inputStyle}
                  value={createForm.email}
                  onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: '#5a3e2b' }}>Password</label>
                <input required type="password" className={`${inputClass} w-full`} style={inputStyle}
                  placeholder="Min 8 characters"
                  value={createForm.password}
                  onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))} />
              </div>
            </div>
            {createError && <p className="text-xs text-red-600">{createError}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={busy}
                className="px-3 py-1 rounded text-sm text-white disabled:opacity-50"
                style={{ backgroundColor: '#8b4513' }}>
                {busy ? 'Creating…' : 'Create & Assign'}
              </button>
              <button type="button" onClick={() => { setShowCreateForm(false); setCreateForm(emptyForm); setCreateError(''); }}
                className="px-3 py-1 rounded text-sm border" style={{ borderColor: '#d4b896', color: '#5a3e2b' }}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
