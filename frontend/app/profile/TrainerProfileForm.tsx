'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface TrainerProfile {
  id: string;
  name: string;
  private_email: string;
  private_phone: string | null;
  public_email: string | null;
  public_phone: string | null;
}

export default function TrainerProfileForm({ trainer }: { trainer: TrainerProfile | null }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: trainer?.name ?? '',
    private_email: trainer?.private_email ?? '',
    private_phone: trainer?.private_phone ?? '',
    public_email: trainer?.public_email ?? '',
    public_phone: trainer?.public_phone ?? '',
    current_password: '',
  });
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  if (!trainer) {
    return (
      <p className="text-sm" style={{ color: '#8b7355' }}>
        No trainer registry profile is linked to this account yet. Ask an admin to review the trainer registry.
      </p>
    );
  }
  const originalPrivateEmail = trainer.private_email;

  async function handleSave() {
    if (!form.name.trim() || !form.private_email.trim() || !form.private_phone.trim()) {
      setMessage({ type: 'error', text: 'Name, private email, and private phone are required.' });
      return;
    }

    setSaving(true);
    setMessage(null);
    const privateEmailChanged = form.private_email !== originalPrivateEmail;
    const res = await fetch('/api/trainers/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        private_email: form.private_email,
        private_phone: form.private_phone,
        public_email: form.public_email || null,
        public_phone: form.public_phone || null,
        current_password: privateEmailChanged ? form.current_password : undefined,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setMessage({ type: 'success', text: 'Trainer profile updated.' });
      router.refresh();
    } else {
      const json = await res.json();
      setMessage({ type: 'error', text: json.detail || 'Failed to update trainer profile.' });
    }
  }

  return (
    <div className="space-y-4">
      {[
        { name: 'name', label: 'Display Name', type: 'text' },
        { name: 'private_email', label: 'Private Email', type: 'email' },
        { name: 'private_phone', label: 'Private Phone', type: 'tel' },
        { name: 'public_email', label: 'Public Email', type: 'email' },
        { name: 'public_phone', label: 'Public Phone', type: 'tel' },
      ].map((field) => (
        <div key={field.name}>
          <label className="block text-sm font-medium mb-1" style={{ color: '#5a3e2b' }}>
            {field.label}
          </label>
          <input
            type={field.type}
            value={(form as Record<string, string>)[field.name]}
            onChange={(e) => setForm((prev) => ({ ...prev, [field.name]: e.target.value }))}
            className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1"
            style={{ borderColor: '#d4b896' }}
          />
        </div>
      ))}

      {form.private_email !== originalPrivateEmail && (
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: '#5a3e2b' }}>
            Current Password
          </label>
          <input
            type="password"
            value={form.current_password}
            onChange={(e) => setForm((prev) => ({ ...prev, current_password: e.target.value }))}
            className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1"
            style={{ borderColor: '#d4b896' }}
            placeholder="Required to change private email"
          />
        </div>
      )}

      <p className="text-xs" style={{ color: '#8b7355' }}>
        Private contact fields are required and visible only to your account/admin workflows. Public fields are optional and can be shown with your trainer record.
      </p>

      {message && (
        <p className={`text-sm ${message.type === 'success' ? 'text-green-700' : 'text-red-600'}`}>
          {message.text}
        </p>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
        style={{ backgroundColor: '#8b4513' }}
      >
        {saving ? 'Saving...' : 'Save Trainer Profile'}
      </button>
    </div>
  );
}
