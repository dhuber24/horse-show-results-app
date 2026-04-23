'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const ROLES = ['ADMIN', 'SHOW_SECRETARY', 'SCOREKEEPER', 'EXHIBITOR'];

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Admin',
  SHOW_SECRETARY: 'Show Secretary',
  SCOREKEEPER: 'Scorekeeper',
  EXHIBITOR: 'Exhibitor',
};

interface Props {
  user: { id: string; role: string };
}

export default function ChangeRoleForm({ user }: Props) {
  const router = useRouter();
  const [role, setRole] = useState(user.role);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isDirty = role !== user.role;

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    const res = await fetch(`/api/users/${user.id}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    setSaving(false);
    if (res.ok) {
      setMessage({ type: 'success', text: 'Role updated.' });
      router.refresh();
    } else {
      const json = await res.json();
      setMessage({ type: 'error', text: json.detail || 'Failed to update role.' });
    }
  };

  return (
    <div className="space-y-3">
      <select
        value={role}
        onChange={e => setRole(e.target.value)}
        className="border rounded px-3 py-2 text-sm focus:outline-none"
        style={{ borderColor: '#d4b896' }}
      >
        {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>)}
      </select>
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || !isDirty}
          className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: '#8b4513' }}
        >
          {saving ? 'Saving…' : 'Update Role'}
        </button>
        {message && (
          <p className={`text-sm ${message.type === 'success' ? 'text-green-700' : 'text-red-600'}`}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
