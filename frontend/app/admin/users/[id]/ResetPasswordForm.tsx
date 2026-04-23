'use client';

import { useState } from 'react';

interface Props {
  userId: string;
}

export default function ResetPasswordForm({ userId }: Props) {
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleReset = async () => {
    setSaving(true);
    setMessage(null);
    const res = await fetch(`/api/users/${userId}/password`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_password: password }),
    });
    setSaving(false);
    if (res.ok) {
      setMessage({ type: 'success', text: 'Password reset successfully.' });
      setPassword('');
    } else {
      const json = await res.json();
      setMessage({ type: 'error', text: json.detail || 'Failed to reset password.' });
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: '#5a3e2b' }}>New Password</label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Min 8 characters"
          className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1"
          style={{ borderColor: '#d4b896' }}
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={handleReset}
          disabled={saving || password.length < 8}
          className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: '#8b4513' }}
        >
          {saving ? 'Resetting…' : 'Reset Password'}
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
