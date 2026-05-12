'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import TrainerSelect from '@/components/TrainerSelect';

interface Breed { id: string; name: string; }
interface HorseColor { id: string; name: string; }
interface Exhibitor { id: string; full_name: string; }
interface ShowType { id: string; code: string; name: string; }
interface Trainer { id: string; name: string; }
interface PendingReg { show_type_id: string; show_type_code: string; show_type_name: string; registration_number: string; }
interface PendingRider { exhibitor_id: string; full_name: string; }

interface Props {
  breeds: Breed[];
  colors: HorseColor[];
  exhibitors: Exhibitor[];
  showTypes: ShowType[];
  trainers: Trainer[];
}

const UNCERTIFIED_CODES = ['OPEN'];

export default function NewHorseForm({ breeds, colors, exhibitors, showTypes, trainers }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    owner_exhibitor_id: '',
    trainer_id: '',
    trainer_name: '',
    sex: '',
    foaling_date: '',
    breed_id: '',
    color_id: '',
    is_solid_paint_bred: false,
  });
  const [pendingRegs, setPendingRegs] = useState<PendingReg[]>([]);
  const [newReg, setNewReg] = useState({ show_type_id: '', registration_number: '' });
  const [pendingRiders, setPendingRiders] = useState<PendingRider[]>([]);
  const [newRiderId, setNewRiderId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regError, setRegError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleAddReg = async () => {
    if (!newReg.show_type_id || !newReg.registration_number.trim()) {
      setRegError('Select an association and enter a registration number.');
      return;
    }
    const trimmed = newReg.registration_number.trim();
    const st = showTypes.find((s) => s.id === newReg.show_type_id)!;

    const qs = new URLSearchParams({ show_type_id: newReg.show_type_id, registration_number: trimmed });
    const lookupRes = await fetch(`/api/horses/registrations/lookup?${qs.toString()}`);
    if (lookupRes.ok) {
      const existing = await lookupRes.json();
      const owner = existing.owner_name ? ` (owner: ${existing.owner_name})` : '';
      setRegError(`${st.code} #${trimmed} is already on file for horse "${existing.horse_name}"${owner}.`);
      return;
    }

    setPendingRegs((prev) => [...prev, {
      show_type_id: newReg.show_type_id,
      show_type_code: st.code,
      show_type_name: st.name,
      registration_number: trimmed,
    }]);
    setNewReg({ show_type_id: '', registration_number: '' });
    setRegError(null);
  };

  const handleRemoveReg = (show_type_id: string) => {
    setPendingRegs((prev) => prev.filter((r) => r.show_type_id !== show_type_id));
  };

  const handleAddRider = () => {
    if (!newRiderId) return;
    const exhibitor = exhibitors.find((e) => e.id === newRiderId)!;
    setPendingRiders((prev) => [...prev, { exhibitor_id: exhibitor.id, full_name: exhibitor.full_name }]);
    setNewRiderId('');
  };

  const handleRemoveRider = (exhibitor_id: string) => {
    setPendingRiders((prev) => prev.filter((r) => r.exhibitor_id !== exhibitor_id));
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Horse name is required.'); return; }
    setSaving(true);
    setError(null);

    const body: Record<string, unknown> = {
      name: form.name.trim(),
      owner_exhibitor_id: form.owner_exhibitor_id || null,
      trainer_id: form.trainer_id || null,
      trainer_name: form.trainer_name.trim() || null,
      is_solid_paint_bred: form.is_solid_paint_bred,
    };
    if (form.sex) body.sex = form.sex;
    if (form.foaling_date) body.foaling_date = form.foaling_date;
    if (form.breed_id) body.breed_id = form.breed_id;
    if (form.color_id) body.color_id = form.color_id;

    const res = await fetch('/api/horses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      setSaving(false);
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to create horse.');
      return;
    }

    const horse = await res.json();

    const regFailures: string[] = [];
    for (const reg of pendingRegs) {
      const regRes = await fetch(`/api/horses/${horse.id}/registrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_type_id: reg.show_type_id, registration_number: reg.registration_number }),
      });
      if (!regRes.ok) {
        const err = await regRes.json().catch(() => ({}));
        regFailures.push(`${reg.show_type_code} #${reg.registration_number}: ${err.detail ?? 'failed to add'}`);
      }
    }

    if (regFailures.length > 0) {
      await fetch(`/api/horses/${horse.id}`, { method: 'DELETE' });
      setSaving(false);
      setError(`Horse not saved: ${regFailures.join('; ')}`);
      return;
    }

    for (const rider of pendingRiders) {
      await fetch(`/api/horses/${horse.id}/riders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exhibitor_id: rider.exhibitor_id }),
      });
    }

    router.push(`/admin/horses/${horse.id}`);
  };

  const usedShowTypeIds = new Set(pendingRegs.map((r) => r.show_type_id));
  const availableShowTypes = showTypes.filter(
    (st) => !UNCERTIFIED_CODES.includes(st.code) && !usedShowTypeIds.has(st.id)
  );

  const pendingRiderIds = new Set(pendingRiders.map((r) => r.exhibitor_id));
  const availableRiderExhibitors = exhibitors.filter((e) => !pendingRiderIds.has(e.id));

  const displayAge = form.foaling_date
    ? Math.max(0, new Date().getFullYear() - new Date(form.foaling_date).getFullYear())
    : null;

  return (
    <div className="space-y-6">
      <div className="border rounded-lg p-4 space-y-4" style={{ borderColor: '#d4b896' }}>
        <h2 className="font-semibold" style={{ color: '#2c1810' }}>Horse Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="text-sm block mb-1" style={{ color: '#8b7355' }}>Name *</label>
            <input name="name" value={form.name} onChange={handleChange} className="w-full border rounded px-3 py-2" placeholder="Horse name" />
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm block mb-1" style={{ color: '#8b7355' }}>Owner</label>
            <select name="owner_exhibitor_id" value={form.owner_exhibitor_id} onChange={handleChange} className="w-full border rounded px-3 py-2">
              <option value="">Select exhibitor...</option>
              {exhibitors.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm block mb-1" style={{ color: '#8b7355' }}>Trainer</label>
            <TrainerSelect
              trainerId={form.trainer_id || null}
              trainerName={form.trainer_name || null}
              trainers={trainers}
              onChange={(trainerId, trainerName) => setForm((prev) => ({
                ...prev,
                trainer_id: trainerId ?? '',
                trainer_name: trainerName ?? '',
              }))}
            />
          </div>
          <div>
            <label className="text-sm block mb-1" style={{ color: '#8b7355' }}>Sex</label>
            <select name="sex" value={form.sex} onChange={handleChange} className="w-full border rounded px-3 py-2">
              <option value="">- Not specified -</option>
              <option value="Mare">Mare</option>
              <option value="Gelding">Gelding</option>
              <option value="Stallion">Stallion</option>
            </select>
          </div>
          <div>
            <label className="text-sm block mb-1" style={{ color: '#8b7355' }}>
              Foaling Date
              {displayAge !== null && <span className="ml-2 font-medium" style={{ color: '#8b4513' }}>(Age: {displayAge})</span>}
            </label>
            <input name="foaling_date" type="date" value={form.foaling_date} onChange={handleChange} className="w-full border rounded px-3 py-2" />
          </div>
          <div>
            <label className="text-sm block mb-1" style={{ color: '#8b7355' }}>Breed</label>
            <select name="breed_id" value={form.breed_id} onChange={handleChange} className="w-full border rounded px-3 py-2">
              <option value="">- Not specified -</option>
              {breeds.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm block mb-1" style={{ color: '#8b7355' }}>Color</label>
            <select name="color_id" value={form.color_id} onChange={handleChange} className="w-full border rounded px-3 py-2">
              <option value="">- Not specified -</option>
              {colors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <input
              type="checkbox"
              id="is_solid_paint_bred"
              checked={form.is_solid_paint_bred}
              onChange={(e) => setForm((prev) => ({ ...prev, is_solid_paint_bred: e.target.checked }))}
              className="h-4 w-4"
            />
            <label htmlFor="is_solid_paint_bred" className="text-sm" style={{ color: '#8b7355' }}>
              Solid Paint-Bred (SPB) - cannot enter Regular Registry Open classes
            </label>
          </div>
        </div>
      </div>

      <div className="border rounded-lg p-4 space-y-4" style={{ borderColor: '#d4b896' }}>
        <h2 className="font-semibold" style={{ color: '#2c1810' }}>Rider(s)</h2>
        {pendingRiders.length > 0 ? (
          <ul className="space-y-2">
            {pendingRiders.map((r) => (
              <li key={r.exhibitor_id} className="flex items-center justify-between p-3 rounded border" style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0' }}>
                <span className="text-sm" style={{ color: '#2c1810' }}>{r.full_name}</span>
                <button onClick={() => handleRemoveRider(r.exhibitor_id)} className="text-xs text-red-600 hover:text-red-800 ml-4 shrink-0">Remove</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm" style={{ color: '#8b7355' }}>No riders added yet.</p>
        )}
        {availableRiderExhibitors.length > 0 && (
          <div className="flex flex-wrap gap-2 items-end pt-1">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Add Rider</label>
              <select value={newRiderId} onChange={(e) => setNewRiderId(e.target.value)} className="w-full border rounded px-3 py-2 text-sm">
                <option value="">Select exhibitor...</option>
                {availableRiderExhibitors.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </div>
            <button onClick={handleAddRider} className="px-4 py-2 rounded text-sm font-medium" style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}>Add</button>
          </div>
        )}
      </div>

      <div className="border rounded-lg p-4 space-y-4" style={{ borderColor: '#d4b896' }}>
        <h2 className="font-semibold" style={{ color: '#2c1810' }}>Association Registration Numbers</h2>
        {pendingRegs.length > 0 ? (
          <ul className="space-y-2">
            {pendingRegs.map((r) => (
              <li key={r.show_type_id} className="flex items-center justify-between p-3 rounded border" style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0' }}>
                <div>
                  <span className="font-mono text-sm font-semibold" style={{ color: '#8b4513' }}>{r.show_type_code}</span>
                  <span className="text-sm ml-2" style={{ color: '#2c1810' }}>{r.registration_number}</span>
                  <span className="text-xs ml-2" style={{ color: '#8b7355' }}>{r.show_type_name}</span>
                </div>
                <button onClick={() => handleRemoveReg(r.show_type_id)} className="text-xs text-red-600 hover:text-red-800 ml-4">Remove</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm" style={{ color: '#8b7355' }}>No registrations added yet.</p>
        )}
        {availableShowTypes.length > 0 && (
          <div className="flex flex-wrap gap-2 items-end pt-1">
            <div className="flex-1 min-w-[160px]">
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Association</label>
              <select value={newReg.show_type_id} onChange={(e) => setNewReg((p) => ({ ...p, show_type_id: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm">
                <option value="">Select...</option>
                {availableShowTypes.map((st) => <option key={st.id} value={st.id}>{st.code} - {st.name}</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Registration #</label>
              <input value={newReg.registration_number} onChange={(e) => setNewReg((p) => ({ ...p, registration_number: e.target.value }))} placeholder="e.g. 1234567" className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <button onClick={handleAddReg} className="px-4 py-2 rounded text-sm font-medium" style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}>Add</button>
          </div>
        )}
        {regError && <p className="text-red-600 text-sm">{regError}</p>}
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex gap-3">
        <button onClick={handleSave} disabled={saving} className="px-6 py-2 rounded font-medium disabled:opacity-50" style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}>
          {saving ? 'Creating...' : 'Create Horse'}
        </button>
        <button onClick={() => router.push('/admin/horses')} className="px-6 py-2 rounded font-medium border" style={{ borderColor: '#d4b896', color: '#8b7355' }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
