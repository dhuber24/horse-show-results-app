'use client';

import Link from 'next/link';
import { useState, useMemo } from 'react';

const ROLES = ['ADMIN', 'SHOW_MANAGER', 'SHOW_SECRETARY', 'SCRIBE', 'GATE_STEWARD', 'JUDGE', 'EXHIBITOR', 'TRAINER'];

const ROLE_COLORS: Record<string, string> = {
  ADMIN: 'var(--accent)',
  SHOW_MANAGER: 'var(--warning)',
  SHOW_SECRETARY: 'var(--accent)',
  SCRIBE: 'var(--accent)',
  GATE_STEWARD: 'var(--success)',
  JUDGE: 'var(--warning)',
  EXHIBITOR: 'var(--success-strong)',
  TRAINER: 'var(--warning-strong)',
};

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Admin',
  SHOW_MANAGER: 'Show Manager',
  SHOW_SECRETARY: 'Show Secretary',
  SCRIBE: 'Scribe',
  GATE_STEWARD: 'Gate Steward',
  JUDGE: 'Judge',
  EXHIBITOR: 'Exhibitor',
  TRAINER: 'Trainer',
};

type User = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_approved: boolean;
  last_login_at: string | null;
  created_at: string;
};

function formatLastLogin(value: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US');
}

function exportCsv(users: User[]) {
  const header = ['Name', 'Email', 'Role', 'Last Login', 'Joined'];
  const rows = users.map(u => [
    u.full_name,
    u.email,
    u.role,
    u.last_login_at ? new Date(u.last_login_at).toISOString() : 'Never',
    new Date(u.created_at).toISOString(),
  ]);
  const csv = [header, ...rows]
    .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function UserTable({ initialUsers }: { initialUsers: User[] }) {
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<{ id: string; message: string } | null>(null);

  const handleDelete = async (user: User) => {
    setDeleting(true);
    setDeleteError(null);
    const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE' });
    if (res.ok) {
      setUsers(prev => prev.filter(u => u.id !== user.id));
      setConfirmDeleteId(null);
    } else {
      const json = await res.json().catch(() => ({}));
      setDeleteError({ id: user.id, message: json.detail || 'Failed to delete user.' });
    }
    setDeleting(false);
  };

  const handleApprove = async (user: User) => {
    setApproving(true);
    setApproveError(null);
    const res = await fetch(`/api/users/${user.id}/approve`, { method: 'POST' });
    if (res.ok) {
      const json = await res.json();
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, is_approved: true } : u));
    } else {
      const json = await res.json().catch(() => ({}));
      setApproveError({ id: user.id, message: json.detail || 'Failed to approve user.' });
    }
    setApproving(false);
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return users.filter(u => {
      const matchesSearch = !q || u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
      const matchesRole = !roleFilter || u.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [users, search, roleFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name or email…"
          className="border rounded px-3 py-1.5 text-sm flex-1 min-w-48 focus:outline-none focus:ring-1"
          style={{ borderColor: 'var(--border)' }}
        />
        <select
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm focus:outline-none"
          style={{ borderColor: 'var(--border)', color: roleFilter ? (ROLE_COLORS[roleFilter] ?? 'var(--text-deep)') : 'var(--text-deep)' }}
        >
          <option value="">All roles</option>
          {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>)}
        </select>
        <button
          onClick={() => exportCsv(filtered)}
          className="border rounded px-3 py-1.5 text-sm font-medium hover:bg-amber-50 transition-colors"
          style={{ borderColor: 'var(--border)', color: 'var(--accent)' }}
        >
          Export CSV
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {users.length === 0 ? 'No users found.' : 'No users match the current filters.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b" style={{ borderColor: 'var(--border)', color: 'var(--text-deep)' }}>
                <th className="pb-2 pr-4 font-semibold">Name</th>
                <th className="pb-2 pr-4 font-semibold">Email</th>
                <th className="pb-2 pr-4 font-semibold">Role</th>
                <th className="pb-2 pr-4 font-semibold">Last Login</th>
                <th className="pb-2 pr-4 font-semibold">Joined</th>
                <th className="pb-2 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(user => (
                <tr key={user.id} className="border-b last:border-0" style={{ borderColor: 'var(--bg-subtle)' }}>
                  <td className="py-3 pr-4 font-medium" style={{ color: 'var(--foreground)' }}>{user.full_name}</td>
                  <td className="py-3 pr-4" style={{ color: 'var(--text-deep)' }}>{user.email}</td>
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{
                          color: ROLE_COLORS[user.role] ?? 'var(--text-deep)',
                          backgroundColor: (ROLE_COLORS[user.role] ?? 'var(--text-deep)') + '18',
                        }}
                      >
                        {ROLE_LABELS[user.role] ?? user.role}
                      </span>
                      {(user.role === 'SHOW_SECRETARY' || user.role === 'SHOW_MANAGER') && !user.is_approved && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100" style={{ color: 'var(--warning-strong)' }}>
                          Pending
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-xs" style={{ color: user.last_login_at ? 'var(--text-deep)' : 'var(--text-dimmed)' }}>
                    {formatLastLogin(user.last_login_at)}
                  </td>
                  <td className="py-3 pr-4 text-xs" style={{ color: 'var(--muted)' }}>
                    {new Date(user.created_at).toLocaleDateString('en-US')}
                  </td>
                  <td className="py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      {confirmDeleteId === user.id ? (
                        <>
                          <span className="text-xs" style={{ color: 'var(--text-deep)' }}>Delete {user.full_name}?</span>
                          <button
                            onClick={() => handleDelete(user)}
                            disabled={deleting}
                            className="text-xs text-red-600 hover:underline disabled:opacity-50"
                          >
                            {deleting ? 'Deleting…' : 'Yes, delete'}
                          </button>
                          <button
                            onClick={() => { setConfirmDeleteId(null); setDeleteError(null); }}
                            disabled={deleting}
                            className="text-xs hover:underline"
                            style={{ color: 'var(--muted)' }}
                          >
                            Cancel
                          </button>
                          {deleteError?.id === user.id && (
                            <span className="text-xs text-red-600">{deleteError.message}</span>
                          )}
                        </>
                      ) : (
                        <>
                          {(user.role === 'SHOW_SECRETARY' || user.role === 'SHOW_MANAGER') && !user.is_approved && (
                            <button
                              onClick={() => handleApprove(user)}
                              disabled={approving}
                              className="text-xs font-medium hover:underline disabled:opacity-50"
                              style={{ color: 'var(--success)' }}
                            >
                              {approving ? 'Approving…' : 'Approve'}
                            </button>
                          )}
                          <Link
                            href={`/admin/users/${user.id}`}
                            className="text-xs font-medium hover:underline"
                            style={{ color: 'var(--accent)' }}
                          >
                            Edit
                          </Link>
                          <button
                            onClick={() => { setConfirmDeleteId(user.id); setDeleteError(null); }}
                            className="text-xs text-red-600 hover:text-red-800"
                          >
                            Delete
                          </button>
                          {approveError?.id === user.id && (
                            <span className="text-xs text-red-600">{approveError.message}</span>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        {filtered.length === users.length
          ? `${users.length} user${users.length !== 1 ? 's' : ''}`
          : `Showing ${filtered.length} of ${users.length} users`}
      </p>

    </div>
  );
}
