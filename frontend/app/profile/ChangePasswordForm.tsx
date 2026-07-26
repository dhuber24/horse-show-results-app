'use client';

import { useState } from 'react';

export default function ChangePasswordForm() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async () => {
    if (!form.current_password || !form.new_password || !form.confirm_password) {
      setError('All fields are required.');
      return;
    }
    if (form.new_password !== form.confirm_password) {
      setError('New passwords do not match.');
      return;
    }
    if (form.new_password.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    setError(null);
    const res = await fetch('/api/profile/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        current_password: form.current_password,
        new_password: form.new_password,
      }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.detail || 'Failed to change password.');
      return;
    }
    setSuccess(true);
    setForm({ current_password: '', new_password: '', confirm_password: '' });
    setOpen(false);
    setTimeout(() => setSuccess(false), 4000);
  };

  if (!open) {
    return (
      <div className="space-y-3">
        {success && (
          <p className="text-sm px-3 py-2 rounded" style={{ backgroundColor: '#f0fdf0', color: '#166534' }}>
            Password changed successfully.
          </p>
        )}
        <button
          onClick={() => setOpen(true)}
          className="px-4 py-2 rounded-lg text-sm font-medium transition"
          style={{ backgroundColor: '#8b4513', color: '#ffffff' }}
        >
          Change Password
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {success && (
        <p className="text-sm px-3 py-2 rounded" style={{ backgroundColor: '#f0fdf0', color: '#166534' }}>
          Password changed successfully.
        </p>
      )}
      {[
        { name: 'current_password', label: 'Current Password' },
        { name: 'new_password', label: 'New Password' },
        { name: 'confirm_password', label: 'Confirm New Password' },
      ].map((field) => (
        <div key={field.name}>
          <label className="block text-sm font-medium mb-1" style={{ color: '#2c1810' }}>{field.label}</label>
          <input
            name={field.name}
            type="password"
            value={(form as any)[field.name]}
            onChange={handleChange}
            placeholder="••••••••"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}
          />
        </div>
      ))}
      {error && (
        <p className="text-sm px-3 py-2 rounded" style={{ backgroundColor: '#fdf0f0', color: '#8b1a1a' }}>
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50"
          style={{ backgroundColor: '#8b4513', color: '#ffffff' }}
        >
          {loading ? 'Changing...' : 'Save New Password'}
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setError(null);
            setForm({ current_password: '', new_password: '', confirm_password: '' });
          }}
          disabled={loading}
          className="px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50"
          style={{ color: '#8b7355' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
