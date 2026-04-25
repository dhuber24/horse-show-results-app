'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Breed { id: string; name: string; }
interface HorseColor { id: string; name: string; }
interface ShowType { id: string; code: string; name: string; }
interface PendingReg { show_type_id: string; show_type_code: string; show_type_name: string; registration_number: string; }
interface Horse {
  id: string;
  name: string;
  sex: string | null;
  age: number | null;
  breed_name: string | null;
  color_name: string | null;
}

interface Props {
  exhibitorId: string;
  initialHorses: Horse[];
}

const UNCERTIFIED_CODES = ['OPEN'];
const emptyForm = { name: '', sex: '', foaling_date: '', breed_id: '', color_id: '', is_solid_paint_bred: false };

export default function MyHorsesPanel({ exhibitorId, initialHorses }: Props) {
  const [horses, setHorses] = useState<Horse[]>(initialHorses);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [breeds, setBreeds] = useState<Breed[]>([]);
  const [colors, setColors] = useState<HorseColor[]>([]);
  const [showTypes, setShowTypes] = useState<ShowType[]>([]);

  const [pendingRegs, setPendingRegs] = useState<PendingReg[]>([]);
  const [newReg, setNewReg] = useState({ show_type_id: '', registration_number: '' });
  const [regError, setRegError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/breeds').then((r) => r.json()).then(setBreeds).catch(() => {});
    fetch('/api/horse-colors').then((r) => r.json()).then(setColors).catch(() => {});
    fetch('/api/show-types').then((r) => r.json()).then(setShowTypes).catch(() => {});
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleAddReg = () => {
    if (!newReg.show_type_id || !newReg.registration_number.trim()) {
      setRegError('Select an association and enter a registration number.');
      return;
    }
    const st = showTypes.find((s) => s.id === newReg.show_type_id)!;
    setPendingRegs((prev) => [...prev, {
      show_type_id: newReg.show_type_id,
      show_type_code: st.code,
      show_type_name: st.name,
      registration_number: newReg.registration_number.trim(),
    }]);
    setNewReg({ show_type_id: '', registration_number: '' });
    setRegError(null);
  };

  const handleRemoveReg = (show_type_id: string) => {
    setPendingRegs((prev) => prev.filter((r) => r.show_type_id !== show_type_id));
  };

  const handleAdd = async () => {
    if (!form.name.trim()) { setError('Horse name is required.'); return; }
    setSaving(true);
    setError(null);

    const body: Record<string, unknown> = {
      name: form.name.trim(),
      is_solid_paint_bred: form.is_solid_paint_bred,
    };
    if (form.sex) body.sex = form.sex;
    if (form.foaling_date) body.foaling_date = form.foaling_date;
    if (form.breed_id) body.breed_id = form.breed_id;
    if (form.color_id) body.color_id = form.color_id;

    const res = await fetch(`/api/exhibitors/${exhibitorId}/owned-horses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      setSaving(false);
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to add horse.');
      return;
    }

    const created = await res.json();

    for (const reg of pendingRegs) {
      await fetch(`/api/horses/${created.id}/registrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_type_id: reg.show_type_id, registration_number: reg.registration_number }),
      });
    }

    setSaving(false);
    setHorses((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    setForm(emptyForm);
    setPendingRegs([]);
    setShowForm(false);
  };

  const handleRemove = async (horseId: string) => {
    setRemovingId(horseId);
    const res = await fetch(`/api/exhibitors/${exhibitorId}/owned-horses/${horseId}`, { method: 'DELETE' });
    setRemovingId(null);
    if (res.ok) {
      setHorses((prev) => prev.filter((h) => h.id !== horseId));
    }
  };

  const usedShowTypeIds = new Set(pendingRegs.map((r) => r.show_type_id));
  const availableShowTypes = showTypes.filter(
    (st) => !UNCERTIFIED_CODES.includes(st.code) && !usedShowTypeIds.has(st.id)
  );

  return (
    <div className="space-y-4">
      {horses.length === 0 && !showForm ? (
        <p className="text-sm" style={{ color: '#8b7355' }}>No horses on your profile yet.</p>
      ) : (
        <ul className="divide-y" style={{ borderColor: '#f0e4d0' }}>
          {horses.map((horse) => (
            <li key={horse.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
              <div className="flex items-center gap-3">
                <span className="text-xl">🐴</span>
                <div>
                  <div className="font-medium text-sm" style={{ color: '#2c1810' }}>
                    {horse.name}
                    {horse.sex && (
                      <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#f5ede0', color: '#8b4513' }}>
                        {horse.sex}
                      </span>
                    )}
                  </div>
                  <div className="text-xs mt-0.5 flex gap-x-2" style={{ color: '#8b7355' }}>
                    {horse.breed_name && <span>{horse.breed_name}</span>}
                    {horse.color_name && <span>{horse.color_name}</span>}
                    {horse.age !== null && horse.age !== undefined && <span>Age: {horse.age}</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 ml-4 shrink-0">
                <Link
                  href={`/profile/horses/${horse.id}`}
                  className="text-xs font-medium hover:underline"
                  style={{ color: '#8b4513' }}
                >
                  Documents
                </Link>
                <button
                  onClick={() => handleRemove(horse.id)}
                  disabled={removingId === horse.id}
                  className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                >
                  {removingId === horse.id ? 'Removing…' : 'Remove'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {showForm ? (
        <div className="border rounded-lg p-4 space-y-4" style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}>
          <h3 className="text-sm font-semibold" style={{ color: '#2c1810' }}>Add a Horse</h3>

          {/* Core fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              name="name"
              placeholder="Horse name *"
              value={form.name}
              onChange={handleChange}
              className="border rounded px-3 py-2 text-sm col-span-full"
            />
            <select name="sex" value={form.sex} onChange={handleChange} className="border rounded px-3 py-2 text-sm">
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
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <select name="breed_id" value={form.breed_id} onChange={handleChange} className="border rounded px-3 py-2 text-sm">
              <option value="">Breed</option>
              {breeds.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select name="color_id" value={form.color_id} onChange={handleChange} className="border rounded px-3 py-2 text-sm">
              <option value="">Color</option>
              {colors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="flex items-center gap-2 col-span-full">
              <input
                type="checkbox"
                id="spb_new"
                checked={form.is_solid_paint_bred}
                onChange={(e) => setForm((prev) => ({ ...prev, is_solid_paint_bred: e.target.checked }))}
                className="h-4 w-4"
              />
              <label htmlFor="spb_new" className="text-sm" style={{ color: '#8b7355' }}>
                Solid Paint-Bred (SPB)
              </label>
            </div>
          </div>

          {/* Association registrations */}
          <div className="space-y-2 pt-1 border-t" style={{ borderColor: '#e8d5b7' }}>
            <p className="text-xs font-medium pt-2" style={{ color: '#2c1810' }}>Association Registration Numbers</p>

            {pendingRegs.length > 0 && (
              <ul className="space-y-1">
                {pendingRegs.map((r) => (
                  <li key={r.show_type_id} className="flex items-center justify-between p-2 rounded text-sm" style={{ backgroundColor: '#f0e8d8' }}>
                    <span>
                      <span className="font-mono font-semibold mr-2" style={{ color: '#8b4513' }}>{r.show_type_code}</span>
                      {r.registration_number}
                    </span>
                    <button onClick={() => handleRemoveReg(r.show_type_id)} className="text-xs text-red-600 hover:text-red-800 ml-3">
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {availableShowTypes.length > 0 && (
              <div className="flex flex-wrap gap-2 items-end">
                <div className="flex-1 min-w-[140px]">
                  <select
                    value={newReg.show_type_id}
                    onChange={(e) => setNewReg((p) => ({ ...p, show_type_id: e.target.value }))}
                    className="w-full border rounded px-3 py-2 text-sm"
                  >
                    <option value="">Association…</option>
                    {availableShowTypes.map((st) => (
                      <option key={st.id} value={st.id}>{st.code} — {st.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 min-w-[120px]">
                  <input
                    value={newReg.registration_number}
                    onChange={(e) => setNewReg((p) => ({ ...p, registration_number: e.target.value }))}
                    placeholder="Reg #"
                    className="w-full border rounded px-3 py-2 text-sm"
                  />
                </div>
                <button
                  onClick={handleAddReg}
                  className="px-3 py-2 rounded text-sm font-medium"
                  style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
                >
                  Add
                </button>
              </div>
            )}
            {regError && <p className="text-red-600 text-xs">{regError}</p>}
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={saving}
              className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
            >
              {saving ? 'Saving…' : 'Save Horse'}
            </button>
            <button
              onClick={() => { setShowForm(false); setForm(emptyForm); setPendingRegs([]); setError(null); setRegError(null); }}
              className="px-4 py-2 rounded text-sm border"
              style={{ borderColor: '#d4b896', color: '#8b7355' }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="text-sm font-medium hover:underline"
          style={{ color: '#8b4513' }}
        >
          + Add a Horse
        </button>
      )}
    </div>
  );
}
