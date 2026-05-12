'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  user: { full_name: string; email: string; role: string; created_at: string };
}

export default function EditProfileForm({ user }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ full_name: user.full_name, email: user.email });
  const [currentPassword, setCurrentPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const emailChanged = form.email.trim().toLowerCase() !== user.email.trim().toLowerCase();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSave = async () => {
    if (!form.full_name.trim() || !form.email.trim()) {
      setError('Name and email are required.');
      return;
    }
    if (emailChanged && !currentPassword) {
      setError('Confirm your password to change your email.');
      return;
    }
    setLoading(true);
    setError(null);
    const body: Record<string, string> = {
      full_name: form.full_name,
      email: form.email,
    };
    if (emailChanged) body.current_password = currentPassword;
    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.detail || 'Failed to save changes.');
      return;
    }
    setSuccess(true);
    setEditing(false);
    setCurrentPassword('');
    router.refresh();
    setTimeout(() => setSuccess(false), 3000);
  };

  const handleCancel = () => {
    setForm({ full_name: user.full_name, email: user.email });
    setCurrentPassword('');
    setError(null);
    setEditing(false);
  };

  const memberSince = new Date(user.created_at).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="space-y-4">
      {success && (
        <p className="text-sm px-3 py-2 rounded" style={{ backgroundColor: '#f0fdf0', color: '#166534' }}>
          Profile updated successfully.
        </p>
      )}

      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: '#2c1810' }}>Full Name</label>
            <input
              name="full_name"
              type="text"
              value={form.full_name}
              onChange={handleChange}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: '#2c1810' }}>Email</label>
            <input
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}
            />
          </div>
          {emailChanged && (
            <div className="space-y-2 rounded-lg p-3" style={{ backgroundColor: '#fdf6e7', border: '1px solid #e8c97a' }}>
              <p className="text-sm" style={{ color: '#8b5a00' }}>
                This is also the email you log in with. Confirm your password to change it.
              </p>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Current password"
                autoComplete="current-password"
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
              />
            </div>
          )}
          {error && (
            <p className="text-sm px-3 py-2 rounded" style={{ backgroundColor: '#fdf0f0', color: '#8b1a1a' }}>
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={loading}
              className="px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50"
              style={{ backgroundColor: '#8b4513', color: '#ffffff' }}
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
            <button
              onClick={handleCancel}
              className="px-4 py-2 rounded-lg text-sm font-medium transition"
              style={{ backgroundColor: '#f5ede0', color: '#2c1810', border: '1px solid #d4b896' }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-[120px_1fr] gap-y-3 text-sm">
            <span className="font-medium" style={{ color: '#8b7355' }}>Name</span>
            <span style={{ color: '#2c1810' }}>{user.full_name}</span>
            <span className="font-medium" style={{ color: '#8b7355' }}>Email</span>
            <span style={{ color: '#2c1810' }}>{user.email}</span>
            <span className="font-medium" style={{ color: '#8b7355' }}>Role</span>
            <span className="capitalize" style={{ color: '#2c1810' }}>
              {user.role.replace('_', ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}
            </span>
            <span className="font-medium" style={{ color: '#8b7355' }}>Member since</span>
            <span style={{ color: '#2c1810' }}>{memberSince}</span>
          </div>
          <button
            onClick={() => setEditing(true)}
            className="mt-1 px-4 py-2 rounded-lg text-sm font-medium transition"
            style={{ backgroundColor: '#f5ede0', color: '#2c1810', border: '1px solid #d4b896' }}
          >
            Edit
          </button>
        </div>
      )}
    </div>
  );
}
