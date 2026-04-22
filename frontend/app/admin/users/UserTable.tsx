'use client';

import { useState } from 'react';

const ROLES = ['ADMIN', 'SHOW_ADMIN', 'SCOREKEEPER', 'EXHIBITOR'];

const ROLE_COLORS: Record<string, string> = {
  ADMIN: '#7c3aed',
  SHOW_ADMIN: '#1d4ed8',
  SCOREKEEPER: '#0369a1',
  EXHIBITOR: '#166534',
};

type User = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  created_at: string;
};

export default function UserTable({ initialUsers }: { initialUsers: User[] }) {
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function changeRole(userId: string, role: string) {
    setError('');
    setUpdating(userId);
    try {
      const res = await fetch(`/api/users/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.detail || 'Failed to update role');
      } else {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: json.role } : u));
      }
    } finally {
      setUpdating(null);
    }
  }

  if (!users.length) {
    return <p className="text-sm" style={{ color: '#8b7355' }}>No users found.</p>;
  }

  return (
    <>
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b" style={{ borderColor: '#d4b896', color: '#5a3e2b' }}>
              <th className="pb-2 pr-4 font-semibold">Name</th>
              <th className="pb-2 pr-4 font-semibold">Email</th>
              <th className="pb-2 pr-4 font-semibold">Role</th>
              <th className="pb-2 font-semibold">Joined</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr key={user.id} className="border-b last:border-0" style={{ borderColor: '#f0e6d3' }}>
                <td className="py-3 pr-4 font-medium" style={{ color: '#2c1810' }}>{user.full_name}</td>
                <td className="py-3 pr-4" style={{ color: '#5a3e2b' }}>{user.email}</td>
                <td className="py-3 pr-4">
                  <select
                    value={user.role}
                    disabled={updating === user.id}
                    onChange={e => changeRole(user.id, e.target.value)}
                    className="border rounded px-2 py-1 text-xs font-semibold focus:outline-none"
                    style={{
                      borderColor: '#d4b896',
                      color: ROLE_COLORS[user.role] ?? '#333',
                    }}
                  >
                    {ROLES.map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  {updating === user.id && (
                    <span className="ml-2 text-xs" style={{ color: '#8b7355' }}>Saving…</span>
                  )}
                </td>
                <td className="py-3 text-xs" style={{ color: '#8b7355' }}>
                  {new Date(user.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
