'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function CreateHorseForm() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', owner_name: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async () => {
    if (!form.name) { setError('Horse name is required.'); return; }
    setSaving(true);
    setError(null);
    const res = await fetch('/api/horses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (res.ok) {
      router.refresh();
      setForm({ name: '', owner_name: '' });
    } else {
      setError('Failed to add horse.');
    }
  };

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex gap-3">
        <input name="name" placeholder="Horse name *" value={form.name} onChange={handleChange}
          className="flex-1 border rounded px-3 py-2" />
        <input name="owner_name" placeholder="Owner name" value={form.owner_name} onChange={handleChange}
          className="flex-1 border rounded px-3 py-2" />
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button onClick={handleSubmit} disabled={saving}
        className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 disabled:opacity-50">
        {saving ? 'Adding...' : 'Add Horse'}
      </button>
    </div>
  );
}
