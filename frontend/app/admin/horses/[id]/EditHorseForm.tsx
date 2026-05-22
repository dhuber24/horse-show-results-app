'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmDialog from '@/components/ConfirmDialog';
import HorseDocuments from '@/components/HorseDocuments';
import TrainerSelect from '@/components/TrainerSelect';

interface Breed { id: string; name: string; }
interface HorseColor { id: string; name: string; }
interface Exhibitor { id: string; full_name: string; }
interface ShowType { id: string; code: string; name: string; }
interface Registration { id: string; show_type_id: string; show_type_code: string; show_type_name: string; registration_number: string; }
interface Rider { exhibitor_id: string; full_name: string; }
interface Trainer { id: string; name: string; }

interface Horse {
  id: string;
  name: string;
  owner_exhibitor_id: string | null;
  owner_name: string | null;
  trainer_id: string | null;
  trainer_name: string | null;
  foaling_date: string | null;
  sex: string | null;
  breed_id: string | null;
  color_id: string | null;
  is_solid_paint_bred: boolean;
  age: number | null;
}

interface Props {
  horse: Horse;
  breeds: Breed[];
  colors: HorseColor[];
  exhibitors: Exhibitor[];
  showTypes: ShowType[];
  registrations: Registration[];
  trainers: Trainer[];
}

const UNCERTIFIED_CODES = ['OPEN'];

export default function EditHorseForm({ horse, breeds, colors, exhibitors, showTypes, registrations: initialRegs, trainers }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: horse.name,
    owner_exhibitor_id: horse.owner_exhibitor_id ?? '',
    trainer_id: horse.trainer_id ?? '',
    trainer_name: horse.trainer_name ?? '',
    trainer_first_name: '',
    trainer_last_name: '',
    trainer_email: '',
    sex: horse.sex ?? '',
    foaling_date: horse.foaling_date ?? '',
    breed_id: horse.breed_id ?? '',
    color_id: horse.color_id ?? '',
    is_solid_paint_bred: horse.is_solid_paint_bred,
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registrations, setRegistrations] = useState<Registration[]>(initialRegs);
  const [newReg, setNewReg] = useState({ show_type_id: '', registration_number: '' });
  const [addingReg, setAddingReg] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);
  const [confirmDeleteRegId, setConfirmDeleteRegId] = useState<string | null>(null);
  const [riders, setRiders] = useState<Rider[]>([]);

  useEffect(() => {
    fetch(`/api/horses/${horse.id}/riders`).then((r) => r.json()).then(setRiders).catch(() => {});
  }, [horse.id]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Horse name is required.'); return; }
    const hasOtherTrainer = !form.trainer_id && (
      form.trainer_first_name.trim() || form.trainer_last_name.trim() || form.trainer_email.trim()
    );
    if (hasOtherTrainer && (!form.trainer_first_name.trim() || !form.trainer_last_name.trim() || !form.trainer_email.trim())) {
      setError('Trainer first name, last name, and email are required when adding a new trainer.');
      return;
    }
    setSaving(true);
    setError(null);

    const body: Record<string, unknown> = {
      name: form.name.trim(),
      owner_exhibitor_id: form.owner_exhibitor_id || null,
      trainer_id: form.trainer_id || null,
      trainer_name: form.trainer_name.trim() || null,
      trainer_first_name: form.trainer_first_name.trim() || null,
      trainer_last_name: form.trainer_last_name.trim() || null,
      trainer_email: form.trainer_email.trim() || null,
      sex: form.sex || null,
      foaling_date: form.foaling_date || null,
      breed_id: form.breed_id || null,
      color_id: form.color_id || null,
      is_solid_paint_bred: form.is_solid_paint_bred,
    };

    const res = await fetch(`/api/horses/${horse.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) {
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to update horse.');
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    const res = await fetch(`/api/horses/${horse.id}`, { method: 'DELETE' });
    setDeleting(false);
    if (res.ok) router.push('/admin/horses');
    else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to delete horse. It may be linked to existing entries.');
    }
  };

  const handleAddReg = async () => {
    if (!newReg.show_type_id || !newReg.registration_number.trim()) {
      setRegError('Select an association and enter a registration number.');
      return;
    }
    const trimmed = newReg.registration_number.trim();
    setAddingReg(true);
    setRegError(null);
    const qs = new URLSearchParams({ show_type_id: newReg.show_type_id, registration_number: trimmed });
    const lookupRes = await fetch(`/api/horses/registrations/lookup?${qs.toString()}`);
    if (lookupRes.ok) {
      const existing = await lookupRes.json();
      if (existing.horse_id && existing.horse_id !== horse.id) {
        const st = showTypes.find((s) => s.id === newReg.show_type_id);
        const owner = existing.owner_name ? ` (owner: ${existing.owner_name})` : '';
        setRegError(`${st?.code ?? 'Registration'} #${trimmed} is already on file for horse "${existing.horse_name}"${owner}.`);
        setAddingReg(false);
        return;
      }
    }
    const res = await fetch(`/api/horses/${horse.id}/registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ show_type_id: newReg.show_type_id, registration_number: trimmed }),
    });
    setAddingReg(false);
    if (res.ok) {
      const created = await res.json();
      setRegistrations((prev) => [...prev, created]);
      setNewReg({ show_type_id: '', registration_number: '' });
    } else {
      const err = await res.json().catch(() => ({}));
      setRegError(err.detail ?? 'Failed to add registration.');
    }
  };

  const handleDeleteReg = async (regId: string) => {
    const res = await fetch(`/api/horses/${horse.id}/registrations/${regId}`, { method: 'DELETE' });
    if (res.ok) setRegistrations((prev) => prev.filter((r) => r.id !== regId));
  };

  const usedShowTypeIds = new Set(registrations.map((r) => r.show_type_id));
  const availableShowTypes = showTypes.filter((st) => !UNCERTIFIED_CODES.includes(st.code) && !usedShowTypeIds.has(st.id));
  const displayAge = form.foaling_date ? Math.max(0, new Date().getFullYear() - new Date(form.foaling_date).getFullYear()) : horse.age;

  return (
    <div className="space-y-6">
      <div className="border rounded-lg p-4 space-y-4" style={{ borderColor: '#d4b896' }}>
        <h2 className="font-semibold" style={{ color: '#2c1810' }}>Horse Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="text-sm block mb-1" style={{ color: '#8b7355' }}>Name *</label>
            <input name="name" value={form.name} onChange={handleChange} className="w-full border rounded px-3 py-2" />
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm block mb-1" style={{ color: '#8b7355' }}>Owner</label>
            <select name="owner_exhibitor_id" value={form.owner_exhibitor_id} onChange={handleChange} className="w-full border rounded px-3 py-2">
              <option value="">- No owner linked -</option>
              {exhibitors.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
            {!form.owner_exhibitor_id && horse.owner_name && (
              <p className="text-xs mt-1" style={{ color: '#a89070' }}>
                Legacy owner on file: {horse.owner_name}
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm block mb-1" style={{ color: '#8b7355' }}>Trainer</label>
            <TrainerSelect
              trainerId={form.trainer_id || null}
              trainerName={form.trainer_name || null}
              trainerFirstName={form.trainer_first_name || null}
              trainerLastName={form.trainer_last_name || null}
              trainerEmail={form.trainer_email || null}
              trainers={trainers}
              onChange={({ trainerId, trainerName, trainerFirstName, trainerLastName, trainerEmail }) => setForm((prev) => ({
                ...prev,
                trainer_id: trainerId ?? '',
                trainer_name: trainerName ?? '',
                trainer_first_name: trainerFirstName ?? '',
                trainer_last_name: trainerLastName ?? '',
                trainer_email: trainerEmail ?? '',
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
            <label className="text-sm block mb-1" style={{ color: '#8b7355' }}>Foaling Date {displayAge !== null && displayAge !== undefined && <span className="ml-2 font-medium" style={{ color: '#8b4513' }}>(Age: {displayAge})</span>}</label>
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
        </div>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <div className="flex items-center justify-between pt-1">
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 rounded font-medium disabled:opacity-50" style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}>{saving ? 'Saving...' : 'Save Changes'}</button>
          <button onClick={() => setConfirmDelete(true)} className="text-sm text-red-600 hover:text-red-800">Delete Horse</button>
        </div>
        {confirmDelete && <ConfirmDialog title="Delete Horse" message={`Delete ${form.name}? This cannot be undone.`} confirmLabel="Yes, delete" destructive confirming={deleting} onConfirm={handleDelete} onCancel={() => setConfirmDelete(false)} />}
      </div>

      <div className="border rounded-lg p-4 space-y-4" style={{ borderColor: '#d4b896' }}>
        <h2 className="font-semibold" style={{ color: '#2c1810' }}>Riders</h2>
        {riders.length === 0 ? <p className="text-sm" style={{ color: '#8b7355' }}>No riders linked.</p> : (
          <ul className="space-y-2">
            {riders.map((r) => <li key={r.exhibitor_id} className="p-3 rounded border text-sm" style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0', color: '#2c1810' }}>{r.full_name}</li>)}
          </ul>
        )}
      </div>

      <div className="border rounded-lg p-4 space-y-4" style={{ borderColor: '#d4b896' }}>
        <h2 className="font-semibold" style={{ color: '#2c1810' }}>Association Registration Numbers</h2>
        {registrations.length > 0 ? (
          <ul className="space-y-2">
            {registrations.map((r) => (
              <li key={r.id} className="flex items-center justify-between p-3 rounded border" style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0' }}>
                <div><span className="font-mono text-sm font-semibold" style={{ color: '#8b4513' }}>{r.show_type_code}</span><span className="text-sm ml-2" style={{ color: '#2c1810' }}>{r.registration_number}</span></div>
                <button onClick={() => setConfirmDeleteRegId(r.id)} className="text-xs text-red-600 hover:text-red-800 ml-4 shrink-0">Remove</button>
                {confirmDeleteRegId === r.id && <ConfirmDialog title="Remove Registration" message={`Remove ${r.show_type_code} registration? This cannot be undone.`} confirmLabel="Yes, remove" destructive onConfirm={() => { handleDeleteReg(r.id); setConfirmDeleteRegId(null); }} onCancel={() => setConfirmDeleteRegId(null)} />}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm" style={{ color: '#8b7355' }}>No registrations on file.</p>}
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
            <button onClick={handleAddReg} disabled={addingReg} className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50" style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}>{addingReg ? 'Adding...' : 'Add'}</button>
          </div>
        )}
        {regError && <p className="text-red-600 text-sm">{regError}</p>}
      </div>

      <div className="border rounded-lg p-4 space-y-4" style={{ borderColor: '#d4b896' }}>
        <h2 className="font-semibold" style={{ color: '#2c1810' }}>Health & Registration Documents</h2>
        <HorseDocuments horseId={horse.id} />
      </div>
    </div>
  );
}
