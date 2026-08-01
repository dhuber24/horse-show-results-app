'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import BreedCheckboxGroup from '@/components/BreedCheckboxGroup';

interface Breed { id: string; name: string; }
interface HorseColor { id: string; name: string; }
interface Exhibitor { id: string; full_name: string; }

interface Props {
  breeds: Breed[];
  colors: HorseColor[];
  exhibitors: Exhibitor[];
}

export default function CreateHorseForm({ breeds, colors, exhibitors }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    owner_exhibitor_id: '',
    sex: '',
    sire_name: '',
    dam_name: '',
    foaling_date: '',
    breed_ids: [] as string[],
    color_id: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) { setError('Horse name is required.'); return; }
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = { name: form.name.trim() };
    if (form.owner_exhibitor_id) body.owner_exhibitor_id = form.owner_exhibitor_id;
    if (form.sex) body.sex = form.sex;
    if (form.sire_name.trim()) body.sire_name = form.sire_name.trim();
    if (form.dam_name.trim()) body.dam_name = form.dam_name.trim();
    if (form.foaling_date) body.foaling_date = form.foaling_date;
    body.breed_ids = form.breed_ids;
    if (form.color_id) body.color_id = form.color_id;

    const res = await fetch('/api/horses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) {
      router.refresh();
      setForm({ name: '', owner_exhibitor_id: '', sex: '', sire_name: '', dam_name: '', foaling_date: '', breed_ids: [], color_id: '' });
    } else {
      setError('Failed to add horse.');
    }
  };

  return (
    <div className="border rounded-lg p-4 space-y-3" style={{ borderColor: '#d4b896' }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input
          name="name"
          placeholder="Horse name *"
          value={form.name}
          onChange={handleChange}
          className="border rounded px-3 py-2"
        />
        <select name="owner_exhibitor_id" value={form.owner_exhibitor_id} onChange={handleChange} className="border rounded px-3 py-2">
          <option value="">Owner (exhibitor)</option>
          {exhibitors.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
        </select>
        <select name="sex" value={form.sex} onChange={handleChange} className="border rounded px-3 py-2">
          <option value="">Sex</option>
          <option value="Mare">Mare</option>
          <option value="Gelding">Gelding</option>
          <option value="Stallion">Stallion</option>
        </select>
        <div>
          <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Foaling Date</label>
          <input
            name="foaling_date"
            type="date"
            value={form.foaling_date}
            onChange={handleChange}
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <input
          name="sire_name"
          placeholder="Sire"
          value={form.sire_name}
          onChange={handleChange}
          maxLength={200}
          className="border rounded px-3 py-2"
        />
        <input
          name="dam_name"
          placeholder="Dam"
          value={form.dam_name}
          onChange={handleChange}
          maxLength={200}
          className="border rounded px-3 py-2"
        />
        <div className="sm:col-span-2">
          <BreedCheckboxGroup
            breeds={breeds}
            selectedIds={form.breed_ids}
            onChange={(breed_ids) => setForm((prev) => ({ ...prev, breed_ids }))}
          />
        </div>
        <select name="color_id" value={form.color_id} onChange={handleChange} className="border rounded px-3 py-2">
          <option value="">Color</option>
          {colors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button
        onClick={handleSubmit}
        disabled={saving}
        className="px-5 py-2 rounded font-medium disabled:opacity-50"
        style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
      >
        {saving ? 'Adding...' : 'Add Horse'}
      </button>
    </div>
  );
}
