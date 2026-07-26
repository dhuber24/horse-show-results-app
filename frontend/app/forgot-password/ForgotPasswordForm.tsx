'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ForgotPasswordForm() {
  const router = useRouter();
  const [form, setForm] = useState({ email: '', current_password: '', new_password: '', confirm_password: '' });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async () => {
    if (!form.email || !form.current_password || !form.new_password || !form.confirm_password) {
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
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.email,
        current_password: form.current_password,
        new_password: form.new_password,
      }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || 'Failed to reset password.');
      return;
    }
    setSuccess(true);
    setTimeout(() => router.push('/login'), 1500);
  };

  if (success) {
    return (
      <p className="text-sm px-3 py-2 rounded" style={{ backgroundColor: '#f0fdf0', color: '#166534' }}>
        Password updated. Redirecting to sign in...
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: '#2c1810' }}>Email</label>
        <input name="email" type="email" placeholder="you@example.com" value={form.email}
          onChange={handleChange}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
          style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }} />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: '#2c1810' }}>Current Password</label>
        <input name="current_password" type="password" placeholder="••••••••" value={form.current_password}
          onChange={handleChange}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
          style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }} />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: '#2c1810' }}>New Password</label>
        <input name="new_password" type="password" placeholder="••••••••" value={form.new_password}
          onChange={handleChange}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
          style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }} />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: '#2c1810' }}>Confirm New Password</label>
        <input name="confirm_password" type="password" placeholder="••••••••" value={form.confirm_password}
          onChange={handleChange}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
          style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }} />
      </div>
      {error && (
        <p className="text-sm px-3 py-2 rounded" style={{ backgroundColor: '#fdf0f0', color: '#8b1a1a' }}>
          {error}
        </p>
      )}
      <button onClick={handleSubmit} disabled={loading}
        className="w-full py-2 rounded-lg font-medium transition disabled:opacity-50"
        style={{ backgroundColor: '#8b4513', color: '#ffffff' }}>
        {loading ? 'Updating...' : 'Update Password'}
      </button>
    </div>
  );
}
