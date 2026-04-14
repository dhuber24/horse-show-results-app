'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  horse: { id: string; name: string; owner_name: string | null };
}

export default function EditHorseCard({ horse }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({ name: horse.name, owner_name: horse.owner_name ?? '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isDirty = form.name.trim() !== horse.name || form.owner_name.trim() !== (horse.owner_name ?? '');

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    setMessage(null);
    const res = await fetch(`/api/horses/${horse.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(),
        owner_name: form.owner_name.trim() || null,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setMessage({ type: 'success', text: 'Saved.' });
      router.refresh();
    } else {
      setMessage({ type: 'error', text: 'Failed to save.' });
    }
  };

  return (
    <li
      className="p-3 rounded-lg border space-y-2"
      style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}
    >
      <div className="flex gap-2">
        <input
          value={form.name}
          onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          placeholder="Horse name *"
          className="flex-1 border rounded px-2 py-1 text-sm"
          style={{ borderColor: '#d4b896' }}
        />
        <input
          value={form.owner_name}
          onChange={(e) => setForm((p) => ({ ...p, owner_name: e.target.value }))}
          placeholder="Owner name"
          className="flex-1 border rounded px-2 py-1 text-sm"
          style={{ borderColor: '#d4b896' }}
        />
        <button
          onClick={handleSave}
          disabled={saving || !isDirty}
          className="px-3 py-1 rounded text-sm font-medium transition disabled:opacity-40"
          style={{ backgroundColor: '#8b4513', color: '#ffffff' }}
        >
          {saving ? '…' : 'Save'}
        </button>
      </div>
      {message && (
        <p className={`text-xs ${message.type === 'success' ? 'text-green-700' : 'text-red-600'}`}>
          {message.text}
        </p>
      )}
    </li>
  );
}
