'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import BreedCheckboxGroup from '@/components/BreedCheckboxGroup';
import TrainerSelect from '@/components/TrainerSelect';

interface Breed { id: string; name: string; }
interface HorseColor { id: string; name: string; }
interface ShowType { id: string; code: string; name: string; }
interface Registration { id: string; show_type_id: string; show_type_code: string; show_type_name: string; registration_number: string; }

interface Rider { exhibitor_id: string; full_name: string; }

interface Horse {
  id: string;
  name: string;
  owner_name: string | null;
  trainer_id: string | null;
  trainer_name: string | null;
  sex: string | null;
  foaling_date: string | null;
  breed_id: string | null;
  breed_ids?: string[];
  breed_names?: string[];
  color_id: string | null;
  is_solid_paint_bred: boolean;
  age: number | null;
}

interface Props {
  horse: Horse;
  registrations: Registration[];
  isOwner: boolean;
}

const UNCERTIFIED_CODES = ['OPEN'];

export default function EditMyHorseForm({ horse, registrations: initialRegs, isOwner }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: horse.name,
    trainer_id: horse.trainer_id ?? '',
    trainer_name: horse.trainer_name ?? '',
    trainer_first_name: '',
    trainer_last_name: '',
    trainer_email: '',
    sex: horse.sex ?? '',
    foaling_date: horse.foaling_date ?? '',
    breed_ids: horse.breed_ids ?? (horse.breed_id ? [horse.breed_id] : []),
    color_id: horse.color_id ?? '',
    is_solid_paint_bred: horse.is_solid_paint_bred,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [riders, setRiders] = useState<Rider[]>([]);

  const [breeds, setBreeds] = useState<Breed[]>([]);
  const [colors, setColors] = useState<HorseColor[]>([]);
  const [showTypes, setShowTypes] = useState<ShowType[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>(initialRegs);
  const [newReg, setNewReg] = useState({ show_type_id: '', registration_number: '' });
  const [regError, setRegError] = useState<string | null>(null);
  const [addingReg, setAddingReg] = useState(false);

  useEffect(() => {
    fetch('/api/breeds').then((r) => r.json()).then(setBreeds).catch(() => {});
    fetch('/api/horse-colors').then((r) => r.json()).then(setColors).catch(() => {});
    fetch('/api/show-types').then((r) => r.json()).then(setShowTypes).catch(() => {});
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
    setSaved(false);
    const res = await fetch(`/api/horses/${horse.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(),
        trainer_id: form.trainer_id || null,
        trainer_name: form.trainer_name.trim() || null,
        trainer_first_name: form.trainer_first_name.trim() || null,
        trainer_last_name: form.trainer_last_name.trim() || null,
        trainer_email: form.trainer_email.trim() || null,
        sex: form.sex || null,
        foaling_date: form.foaling_date || null,
        breed_ids: form.breed_ids,
        color_id: form.color_id || null,
        is_solid_paint_bred: form.is_solid_paint_bred,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 3000);
    } else {
      setError('Failed to save changes.');
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

    // Pre-flight: warn if registration number already belongs to a different horse
    const qs = new URLSearchParams({ show_type_id: newReg.show_type_id, registration_number: trimmed });
    const lookupRes = await fetch(`/api/horses/registrations/lookup?${qs.toString()}`);
    if (lookupRes.ok) {
      const existing = await lookupRes.json();
      if (existing.horse_id && existing.horse_id !== horse.id) {
        const st = showTypes.find((s) => s.id === newReg.show_type_id);
        const owner = existing.owner_name ? ` (owner: ${existing.owner_name})` : '';
        setRegError(
          `${st?.code ?? 'Registration'} #${trimmed} is already on file for horse "${existing.horse_name}"${owner}. ` +
          `If this is the same horse, contact your show secretary.`
        );
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
    if (res.ok) {
      setRegistrations((prev) => prev.filter((r) => r.id !== regId));
    }
  };

  const usedShowTypeIds = new Set(registrations.map((r) => r.show_type_id));
  const availableShowTypes = showTypes.filter(
    (st) => !UNCERTIFIED_CODES.includes(st.code) && !usedShowTypeIds.has(st.id)
  );

  const displayAge = form.foaling_date
    ? Math.max(0, new Date().getFullYear() - new Date(form.foaling_date).getFullYear())
    : horse.age;

  if (!isOwner) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border p-5 space-y-3" style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}>
          <h2 className="text-lg font-semibold" style={{ color: '#2c1810' }}>Horse Details</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div><dt className="text-xs uppercase tracking-wide" style={{ color: '#a89070' }}>Owner</dt><dd style={{ color: '#2c1810' }}>{horse.owner_name || '-'}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide" style={{ color: '#a89070' }}>Trainer</dt><dd style={{ color: '#2c1810' }}>{form.trainer_name || '-'}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide" style={{ color: '#a89070' }}>Sex</dt><dd style={{ color: '#2c1810' }}>{form.sex || '-'}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide" style={{ color: '#a89070' }}>Foaling Date</dt><dd style={{ color: '#2c1810' }}>{form.foaling_date || '-'}{displayAge !== null && displayAge !== undefined ? ` (age ${displayAge})` : ''}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide" style={{ color: '#a89070' }}>Breeds</dt><dd style={{ color: '#2c1810' }}>{form.breed_ids.map((id) => breeds.find((b) => b.id === id)?.name).filter(Boolean).join(', ') || '-'}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide" style={{ color: '#a89070' }}>Color</dt><dd style={{ color: '#2c1810' }}>{colors.find((c) => c.id === form.color_id)?.name || '-'}</dd></div>
            {form.is_solid_paint_bred && (
              <div className="sm:col-span-2"><dd className="text-xs px-1.5 py-0.5 rounded inline-block font-semibold" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>Solid Paint-Bred (SPB)</dd></div>
            )}
          </dl>
        </div>

        <div className="rounded-lg border p-5 space-y-3" style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}>
          <h2 className="text-lg font-semibold" style={{ color: '#2c1810' }}>Association Registrations</h2>
          {registrations.length > 0 ? (
            <ul className="space-y-2">
              {registrations.map((r) => (
                <li key={r.id} className="p-3 rounded border text-sm" style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0' }}>
                  <span className="font-mono font-semibold" style={{ color: '#8b4513' }}>{r.show_type_code}</span>
                  <span className="ml-2" style={{ color: '#2c1810' }}>{r.registration_number}</span>
                  <span className="text-xs ml-2" style={{ color: '#8b7355' }}>{r.show_type_name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm" style={{ color: '#8b7355' }}>No registrations on file.</p>
          )}
        </div>

        {riders.length > 0 && (
          <div className="rounded-lg border p-5 space-y-3" style={{ borderColor: '#d4b896' }}>
            <h2 className="text-lg font-semibold" style={{ color: '#2c1810' }}>Rider(s)</h2>
            <ul className="space-y-2">
              {riders.map((r) => (
                <li key={r.exhibitor_id} className="p-3 rounded border text-sm" style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0', color: '#2c1810' }}>
                  {r.full_name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Core details */}
      <div className="rounded-lg border p-5 space-y-4" style={{ borderColor: '#d4b896' }}>
        <h2 className="text-lg font-semibold" style={{ color: '#2c1810' }}>Horse Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="text-sm block mb-1" style={{ color: '#8b7355' }}>Name *</label>
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="text-sm block mb-1" style={{ color: '#8b7355' }}>Trainer</label>
            <TrainerSelect
              trainerId={form.trainer_id || null}
              trainerName={form.trainer_name || null}
              trainerFirstName={form.trainer_first_name || null}
              trainerLastName={form.trainer_last_name || null}
              trainerEmail={form.trainer_email || null}
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
            <label className="text-sm block mb-1" style={{ color: '#8b7355' }}>
              Foaling Date
              {displayAge !== null && displayAge !== undefined && (
                <span className="ml-2 font-medium" style={{ color: '#8b4513' }}>(Age: {displayAge})</span>
              )}
            </label>
            <input
              name="foaling_date"
              type="date"
              value={form.foaling_date}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div className="sm:col-span-2">
            <BreedCheckboxGroup
              breeds={breeds}
              selectedIds={form.breed_ids}
              onChange={(breed_ids) => setForm((prev) => ({ ...prev, breed_ids }))}
            />
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
              id="spb_edit"
              checked={form.is_solid_paint_bred}
              onChange={(e) => setForm((prev) => ({ ...prev, is_solid_paint_bred: e.target.checked }))}
              className="h-4 w-4"
            />
            <label htmlFor="spb_edit" className="text-sm" style={{ color: '#8b7355' }}>
              Solid Paint-Bred (SPB)
            </label>
          </div>
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}
        {saved && <p className="text-green-700 text-sm">Changes saved.</p>}

        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 rounded font-medium disabled:opacity-50"
          style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {/* Riders (read-only - managed by show office) */}
      {riders.length > 0 && (
        <div className="rounded-lg border p-5 space-y-3" style={{ borderColor: '#d4b896' }}>
          <h2 className="text-lg font-semibold" style={{ color: '#2c1810' }}>Rider(s)</h2>
          <ul className="space-y-2">
            {riders.map((r) => (
              <li key={r.exhibitor_id} className="p-3 rounded border text-sm" style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0', color: '#2c1810' }}>
                {r.full_name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Association Registrations */}
      <div className="rounded-lg border p-5 space-y-4" style={{ borderColor: '#d4b896' }}>
        <h2 className="text-lg font-semibold" style={{ color: '#2c1810' }}>Association Registration Numbers</h2>

        {registrations.length > 0 ? (
          <ul className="space-y-2">
            {registrations.map((r) => (
              <li key={r.id} className="flex items-center justify-between p-3 rounded border" style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0' }}>
                <div>
                  <span className="font-mono text-sm font-semibold" style={{ color: '#8b4513' }}>{r.show_type_code}</span>
                  <span className="text-sm ml-2" style={{ color: '#2c1810' }}>{r.registration_number}</span>
                  <span className="text-xs ml-2" style={{ color: '#8b7355' }}>{r.show_type_name}</span>
                </div>
                <button
                  onClick={() => handleDeleteReg(r.id)}
                  className="text-xs text-red-600 hover:text-red-800 ml-4 shrink-0"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm" style={{ color: '#8b7355' }}>No registrations on file.</p>
        )}

        {availableShowTypes.length > 0 && (
          <div className="flex flex-wrap gap-2 items-end pt-1">
            <div className="flex-1 min-w-[160px]">
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Association</label>
              <select
                value={newReg.show_type_id}
                onChange={(e) => setNewReg((p) => ({ ...p, show_type_id: e.target.value }))}
                className="w-full border rounded px-3 py-2 text-sm"
              >
                <option value="">Select...</option>
                {availableShowTypes.map((st) => (
                  <option key={st.id} value={st.id}>{st.code} - {st.name}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Registration #</label>
              <input
                value={newReg.registration_number}
                onChange={(e) => setNewReg((p) => ({ ...p, registration_number: e.target.value }))}
                placeholder="e.g. 1234567"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={handleAddReg}
              disabled={addingReg}
              className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
            >
              {addingReg ? 'Adding...' : 'Add'}
            </button>
          </div>
        )}
        {regError && <p className="text-red-600 text-sm">{regError}</p>}
      </div>
    </div>
  );
}

