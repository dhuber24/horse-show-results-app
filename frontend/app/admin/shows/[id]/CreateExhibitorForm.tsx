'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function CreateExhibitorForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!name) { setError('Exhibitor name is required.'); return; }
    setSaving(true);
    setError(null);
    const res = await fetch('/api/exhibitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: name }),
    });
    setSaving(false);
    if (res.ok) {
      router.refresh();
      setName('');
    } else {
      setError('Failed to add exhibitor.');
    }
  };

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <input placeholder="Exhibitor full name *" value={name} onChange={(e) => setName(e.target.value)}
        className="w-full border rounded px-3 py-2" />
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button onClick={handleSubmit} disabled={saving}
        className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 disabled:opacity-50">
        {saving ? 'Adding...' : 'Add Exhibitor'}
      </button>
    </div>
  );
}
