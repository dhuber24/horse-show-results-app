'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function CreateVenueForm() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', address: '', city: '', state: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async () => {
    if (!form.name) {
      setError('Venue name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch('/api/venues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (res.ok) {
      router.push('/admin');
    } else {
      setError('Failed to create venue.');
    }
  };

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <input name="name" placeholder="Venue name *" value={form.name} onChange={handleChange}
        className="w-full border rounded px-3 py-2" />
      <input name="address" placeholder="Address" value={form.address} onChange={handleChange}
        className="w-full border rounded px-3 py-2" />
      <div className="flex gap-3">
        <input name="city" placeholder="City" value={form.city} onChange={handleChange}
          className="flex-1 border rounded px-3 py-2" />
        <input name="state" placeholder="State" value={form.state} onChange={handleChange}
          className="w-24 border rounded px-3 py-2" />
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button onClick={handleSubmit} disabled={saving}
        className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 disabled:opacity-50">
        {saving ? 'Creating...' : 'Add Venue'}
      </button>
    </div>
  );
}
