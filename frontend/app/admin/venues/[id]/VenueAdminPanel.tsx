'use client';

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

  const available = allUsers.filter(
    u => u.role === 'SHOW_ADMIN' && !admins.find(a => a.id === u.id)
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
        <p className="text-sm" style={{ color: '#8b7355' }}>No Show Admins assigned to this venue.</p>
      )}

      <ul className="space-y-1">
        {admins.map(a => (
          <li key={a.id} className="flex items-center justify-between text-sm py-1">
            <span style={{ color: '#2c1810' }}>
              {a.full_name} <span style={{ color: '#8b7355' }}>({a.email})</span>
            </span>
            <button
              disabled={busy}
              onClick={() => remove(a.id)}
              className="text-xs text-red-600 hover:underline disabled:opacity-50"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      {available.length > 0 ? (
        <div className="flex items-center gap-2">
          <select
            id="venue-admin-select"
            className="border rounded px-2 py-1 text-sm flex-1"
            style={{ borderColor: '#d4b896' }}
            defaultValue=""
          >
            <option value="" disabled>Select a Show Admin to add…</option>
            {available.map(u => (
              <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>
            ))}
          </select>
          <button
            disabled={busy}
            onClick={() => {
              const sel = document.getElementById('venue-admin-select') as HTMLSelectElement;
              if (sel.value) add(sel.value);
            }}
            className="px-3 py-1 rounded text-sm text-white disabled:opacity-50"
            style={{ backgroundColor: '#8b4513' }}
          >
            Add
          </button>
        </div>
      ) : (
        <p className="text-xs" style={{ color: '#8b7355' }}>
          No additional Show Admins available. Create one in{' '}
          <a href="/admin/users" className="underline">User Management</a>.
        </p>
      )}
    </div>
  );
}
