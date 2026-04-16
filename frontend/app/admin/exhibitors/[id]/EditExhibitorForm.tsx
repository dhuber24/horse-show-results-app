'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  exhibitor: { id: string; full_name: string };
}

export default function EditExhibitorForm({ exhibitor }: Props) {
  const router = useRouter();
  const [name, setName] = useState(exhibitor.full_name);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isDirty = name.trim() !== exhibitor.full_name;

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setMessage(null);
    const res = await fetch(`/api/exhibitors/${exhibitor.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: name.trim() }),
    });
    setSaving(false);
    if (res.ok) {
      setMessage({ type: 'success', text: 'Exhibitor updated.' });
      router.refresh();
    } else {
      setMessage({ type: 'error', text: 'Failed to update exhibitor.' });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 border rounded-lg px-3 py-2"
          style={{ borderColor: '#d4b896' }}
          placeholder="Exhibitor full name"
        />
        <button
          onClick={handleSave}
          disabled={saving || !isDirty}
          className="px-5 py-2 rounded-lg font-medium transition disabled:opacity-40"
          style={{ backgroundColor: '#8b4513', color: '#ffffff' }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {message && (
        <p className={`text-sm ${message.type === 'success' ? 'text-green-700' : 'text-red-600'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
