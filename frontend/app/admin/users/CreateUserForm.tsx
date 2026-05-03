'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const ROLES = ['ADMIN', 'SHOW_MANAGER', 'SHOW_SECRETARY', 'SCOREKEEPER', 'EXHIBITOR'];

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Admin',
  SHOW_MANAGER: 'Show Manager',
  SHOW_SECRETARY: 'Show Secretary',
  SCOREKEEPER: 'Scorekeeper',
  EXHIBITOR: 'Exhibitor',
};

export default function CreateUserForm() {
  const router = useRouter();
  const [form, setForm] = useState({ email: '', full_name: '', role: 'SHOW_SECRETARY', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.detail || 'Failed to create user');
      } else {
        router.push('/admin/users');
      }
    } finally {
      setLoading(false);
    }
  }

  const inputClass = 'w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1';
  const inputStyle = { borderColor: '#d4b896' };

  return (
    <form onSubmit={handleSubmit} className="grid sm:grid-cols-2 gap-4">
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: '#5a3e2b' }}>Full Name</label>
        <input
          required
          className={inputClass}
          style={inputStyle}
          value={form.full_name}
          onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: '#5a3e2b' }}>Email</label>
        <input
          required
          type="email"
          className={inputClass}
          style={inputStyle}
          value={form.email}
          onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: '#5a3e2b' }}>Role</label>
        <select
          className={inputClass}
          style={inputStyle}
          value={form.role}
          onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
        >
          {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: '#5a3e2b' }}>Password</label>
        <input
          required
          type="password"
          className={inputClass}
          style={inputStyle}
          value={form.password}
          onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
          placeholder="Min 8 characters"
        />
      </div>

      {error && <p className="sm:col-span-2 text-sm text-red-600">{error}</p>}

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: '#8b4513' }}
        >
          {loading ? 'Creating…' : 'Create User'}
        </button>
      </div>
    </form>
  );
}
