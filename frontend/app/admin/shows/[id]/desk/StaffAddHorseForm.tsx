'use client';

import { useState } from 'react';

export interface AssociationOption {
  id: string;
  code: string;
  name: string;
  association_type: 'breed' | 'club';
}

export interface LookupOption {
  id: string;
  name: string;
}

interface PendingReg {
  association_id: string;
  registration_number: string;
}

const SEXES = ['Mare', 'Gelding', 'Stallion'];

/**
 * Show staff adding a horse for an exhibitor who is at the desk without one on
 * their profile. The exhibitor ends up owning it — staff are filling in a form
 * on their behalf, not taking the horse.
 *
 * The fields offered are deliberately the ones the paperwork sweep asks about:
 * registered name, foaling date, and association registration numbers. Anything
 * else the exhibitor can fill in later from their own profile.
 */
export default function StaffAddHorseForm({
  showId,
  exhibitorId,
  exhibitorName,
  associations,
  breeds,
  colors,
  onCreated,
  onCancel,
}: {
  showId: string;
  exhibitorId: string;
  exhibitorName: string;
  associations: AssociationOption[];
  breeds: LookupOption[];
  colors: LookupOption[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: '',
    barn_name: '',
    foaling_date: '',
    sex: '',
    breed_id: '',
    color_id: '',
    sire_name: '',
    dam_name: '',
  });
  const [regs, setRegs] = useState<PendingReg[]>([]);
  const [newReg, setNewReg] = useState<PendingReg>({ association_id: '', registration_number: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usedAssociationIds = new Set(regs.map((r) => r.association_id));
  const availableAssociations = associations.filter((a) => !usedAssociationIds.has(a.id));

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const addReg = () => {
    if (!newReg.association_id || !newReg.registration_number.trim()) {
      setError('Pick an association and enter the registration number.');
      return;
    }
    setError(null);
    setRegs((prev) => [...prev, { ...newReg, registration_number: newReg.registration_number.trim() }]);
    setNewReg({ association_id: '', registration_number: '' });
  };

  const submit = async () => {
    if (!form.name.trim()) {
      setError('The registered name is required — it is what the horse is entered under.');
      return;
    }
    setSaving(true);
    setError(null);

    const body: Record<string, unknown> = {
      name: form.name.trim(),
      registrations: regs,
    };
    if (form.barn_name.trim()) body.barn_name = form.barn_name.trim();
    if (form.foaling_date) body.foaling_date = form.foaling_date;
    if (form.sex) body.sex = form.sex;
    if (form.breed_id) body.breed_id = form.breed_id;
    if (form.color_id) body.color_id = form.color_id;
    if (form.sire_name.trim()) body.sire_name = form.sire_name.trim();
    if (form.dam_name.trim()) body.dam_name = form.dam_name.trim();

    const res = await fetch(`/api/shows/${showId}/exhibitors/${exhibitorId}/horses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);

    if (res.ok) {
      onCreated();
      return;
    }
    const err = await res.json().catch(() => ({}));
    const detail = err.detail;
    setError(typeof detail === 'string' ? detail : detail?.message ?? 'Could not create the horse.');
  };

  const inputStyle = { borderColor: '#d4b896' };

  return (
    <div className="mt-2 rounded border p-3 space-y-3" style={{ borderColor: '#d4b896', backgroundColor: '#fffdf9' }}>
      <div className="flex items-center justify-between">
        <h5 className="text-sm font-semibold" style={{ color: '#2c1810' }}>
          Add a horse for {exhibitorName}
        </h5>
        <button type="button" onClick={onCancel} className="text-xs hover:underline" style={{ color: '#8b7355' }}>
          Cancel
        </button>
      </div>
      <p className="text-xs" style={{ color: '#8b7355' }}>
        {exhibitorName} will own this horse and it will appear on their profile.
      </p>

      <div className="grid sm:grid-cols-2 gap-2">
        <label className="text-xs" style={{ color: '#8b7355' }}>
          Registered name *
          <input
            name="name" value={form.name} onChange={handleChange}
            placeholder="Name on the papers"
            className="w-full border rounded px-2 py-1.5 text-sm mt-0.5" style={inputStyle}
          />
        </label>
        <label className="text-xs" style={{ color: '#8b7355' }}>
          Barn name
          <input
            name="barn_name" value={form.barn_name} onChange={handleChange}
            className="w-full border rounded px-2 py-1.5 text-sm mt-0.5" style={inputStyle}
          />
        </label>
        <label className="text-xs" style={{ color: '#8b7355' }}>
          Foaling date
          <input
            name="foaling_date" type="date" value={form.foaling_date} onChange={handleChange}
            className="w-full border rounded px-2 py-1.5 text-sm mt-0.5" style={inputStyle}
          />
        </label>
        <label className="text-xs" style={{ color: '#8b7355' }}>
          Sex
          <select
            name="sex" value={form.sex} onChange={handleChange}
            className="w-full border rounded px-2 py-1.5 text-sm mt-0.5" style={inputStyle}
          >
            <option value="">— Not specified —</option>
            {SEXES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="text-xs" style={{ color: '#8b7355' }}>
          Breed
          <select
            name="breed_id" value={form.breed_id} onChange={handleChange}
            className="w-full border rounded px-2 py-1.5 text-sm mt-0.5" style={inputStyle}
          >
            <option value="">— Not specified —</option>
            {breeds.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="text-xs" style={{ color: '#8b7355' }}>
          Color
          <select
            name="color_id" value={form.color_id} onChange={handleChange}
            className="w-full border rounded px-2 py-1.5 text-sm mt-0.5" style={inputStyle}
          >
            <option value="">— Not specified —</option>
            {colors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-xs" style={{ color: '#8b7355' }}>
          Sire
          <input
            name="sire_name" value={form.sire_name} onChange={handleChange}
            className="w-full border rounded px-2 py-1.5 text-sm mt-0.5" style={inputStyle}
          />
        </label>
        <label className="text-xs" style={{ color: '#8b7355' }}>
          Dam
          <input
            name="dam_name" value={form.dam_name} onChange={handleChange}
            className="w-full border rounded px-2 py-1.5 text-sm mt-0.5" style={inputStyle}
          />
        </label>
      </div>

      <div className="pt-2 border-t" style={{ borderColor: '#f0e6d6' }}>
        <p className="text-xs font-semibold mb-1.5" style={{ color: '#8b4513' }}>Registrations</p>
        {regs.length > 0 && (
          <ul className="space-y-1 mb-2">
            {regs.map((r) => {
              const assoc = associations.find((a) => a.id === r.association_id);
              return (
                <li
                  key={r.association_id}
                  className="flex items-center justify-between text-sm px-2 py-1 rounded"
                  style={{ backgroundColor: '#f0e8d8', color: '#5a3e2b' }}
                >
                  <span>
                    <span className="font-mono font-semibold">{assoc?.code ?? '—'}</span>
                    <span className="ml-2 font-mono text-xs">{r.registration_number}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setRegs((prev) => prev.filter((x) => x.association_id !== r.association_id))}
                    className="text-xs text-red-600 hover:text-red-800"
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex gap-2">
          <select
            value={newReg.association_id}
            onChange={(e) => setNewReg((p) => ({ ...p, association_id: e.target.value }))}
            className="border rounded px-2 py-1.5 text-sm" style={inputStyle}
          >
            <option value="">Association</option>
            {availableAssociations.map((a) => (
              <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
            ))}
          </select>
          <input
            value={newReg.registration_number}
            onChange={(e) => setNewReg((p) => ({ ...p, registration_number: e.target.value }))}
            placeholder="Registration number"
            className="flex-1 border rounded px-2 py-1.5 text-sm" style={inputStyle}
          />
          <button
            type="button"
            onClick={addReg}
            className="text-sm px-3 py-1.5 rounded border hover:bg-amber-50"
            style={{ borderColor: '#d4b896', color: '#8b4513' }}
          >
            Add
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={saving}
        className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
        style={{ backgroundColor: '#8b4513' }}
      >
        {saving ? 'Creating…' : 'Create horse'}
      </button>
    </div>
  );
}
