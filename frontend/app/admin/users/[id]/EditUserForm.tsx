'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  user: {
    id: string;
    first_name: string;
    last_name: string;
    full_name: string;
    email: string;
    aqha_management_workshop_completed_at: string | null;
  };
}

export default function EditUserForm({ user }: Props) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(user.first_name);
  const [lastName, setLastName] = useState(user.last_name);
  const [email, setEmail] = useState(user.email);
  const [aqhaWorkshopDate, setAqhaWorkshopDate] = useState(user.aqha_management_workshop_completed_at ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isDirty =
    firstName.trim() !== user.first_name ||
    lastName.trim() !== user.last_name ||
    email.trim() !== user.email ||
    aqhaWorkshopDate !== (user.aqha_management_workshop_completed_at ?? '');

  const handleSave = async () => {
    if (!firstName.trim() || !lastName.trim() || !email.trim()) return;
    setSaving(true);
    setMessage(null);
    const res = await fetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        aqha_management_workshop_completed_at: aqhaWorkshopDate || null,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setMessage({ type: 'success', text: 'Profile updated.' });
      router.refresh();
    } else {
      const json = await res.json();
      setMessage({ type: 'error', text: json.detail || 'Failed to update profile.' });
    }
  };

  const inputClass = 'w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1';
  const inputStyle = { borderColor: '#d4b896' };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: '#5a3e2b' }}>First Name</label>
        <input
          value={firstName}
          onChange={e => setFirstName(e.target.value)}
          className={inputClass}
          style={inputStyle}
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: '#5a3e2b' }}>Last Name</label>
        <input
          value={lastName}
          onChange={e => setLastName(e.target.value)}
          className={inputClass}
          style={inputStyle}
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: '#5a3e2b' }}>Email</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className={inputClass}
          style={inputStyle}
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: '#5a3e2b' }}>
          AQHA Show-Management Workshop Date
        </label>
        <input
          type="date"
          value={aqhaWorkshopDate}
          onChange={e => setAqhaWorkshopDate(e.target.value)}
          className={inputClass}
          style={inputStyle}
        />
        <p className="text-xs mt-1" style={{ color: '#8b7355' }}>
          Used by AQHA validation to confirm at least one assigned manager or secretary is workshop-current within 3 years.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || !isDirty}
          title={!isDirty ? 'No changes to save' : saving ? 'Saving, please wait…' : undefined}
          className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: '#8b4513' }}
        >
          {saving ? 'Saving…' : 'Save Changes'}
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
