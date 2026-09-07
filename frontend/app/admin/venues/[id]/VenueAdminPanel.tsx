'use client';

import Link from 'next/link';
import { useState } from 'react';

type User = { id: string; full_name: string; email: string; role: string };

export default function VenueAdminPanel({
  venueId,
  initialAdmins,
  allUsers,
}: {
  venueId: string;
  initialAdmins: User[];
  allUsers: User[];
}) {
  const [admins, setAdmins] = useState<User[]>(initialAdmins);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState('');

  const available = allUsers.filter(
    u => u.role === 'SHOW_SECRETARY' && !admins.find(a => a.id === u.id)
  );

  async function add(userId: string) {
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`/api/venues/${venueId}/admins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.detail || 'Failed'); return; }
      setAdmins(prev => [...prev, json]);
    } finally { setBusy(false); }
  }

  async function remove(userId: string) {
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`/api/venues/${venueId}/admins/${userId}`, { method: 'DELETE' });
      if (!res.ok) { const j = await res.json(); setError(j.detail || 'Failed'); return; }
      setAdmins(prev => prev.filter(a => a.id !== userId));
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {admins.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>No Secretaries assigned to this venue.</p>
      )}

      <ul className="space-y-1">
        {admins.map(a => (
          <li key={a.id} className="flex items-center justify-between text-sm py-1 flex-wrap gap-2">
            <span style={{ color: 'var(--foreground)' }}>
              {a.full_name} <span style={{ color: 'var(--muted)' }}>({a.email})</span>
            </span>
            {confirmRemoveId === a.id ? (
              <span className="flex items-center gap-2">
                <span className="text-xs" style={{ color: 'var(--text-deep)' }}>Remove {a.full_name}?</span>
                <button
                  disabled={busy}
                  onClick={() => { remove(a.id); setConfirmRemoveId(null); }}
                  className="text-xs text-red-600 hover:underline disabled:opacity-50"
                >
                  Yes, remove
                </button>
                <button
                  onClick={() => setConfirmRemoveId(null)}
                  className="text-xs hover:underline"
                  style={{ color: 'var(--muted)' }}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                disabled={busy}
                onClick={() => setConfirmRemoveId(a.id)}
                className="text-xs text-red-600 hover:underline disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>

      {available.length > 0 ? (
        <div className="flex items-center gap-2">
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            className="border rounded px-2 py-1 text-sm flex-1"
            style={{ borderColor: 'var(--border)' }}
          >
            <option value="" disabled>Select a Show Secretary to add…</option>
            {available.map(u => (
              <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>
            ))}
          </select>
          <button
            disabled={busy}
            onClick={() => {
              if (selectedUserId) { add(selectedUserId); setSelectedUserId(''); }
            }}
            className="px-3 py-1 rounded text-sm text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            Add
          </button>
        </div>
      ) : (
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          No additional Secretaries available. Create one in{' '}
          <Link href="/admin/users" className="underline">User Management</Link>.
        </p>
      )}
    </div>
  );
}
