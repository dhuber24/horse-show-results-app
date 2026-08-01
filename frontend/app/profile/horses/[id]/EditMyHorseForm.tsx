'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import BreedCheckboxGroup from '@/components/BreedCheckboxGroup';
import TrainerSelect from '@/components/TrainerSelect';
import SectionHeader from '@/components/SectionHeader';
import AssociationSelect, { AssociationTypeBadge, AssociationType } from '@/components/AssociationSelect';

interface Breed { id: string; name: string; }
interface HorseColor { id: string; name: string; }
interface Association { id: string; code: string; name: string; association_type: AssociationType; }
interface Registration { id: string; association_id: string; association_code: string; association_name: string; association_type: AssociationType; registration_number: string; }
interface Rider { exhibitor_id: string; full_name: string; }

interface Horse {
  id: string;
  name: string;
  owner_exhibitor_id: string | null;
  owner_exhibitor_name: string | null;
  owner_name: string | null;
  trainer_id: string | null;
  trainer_name: string | null;
  sire_name: string | null;
  dam_name: string | null;
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

interface ExhibitorName { id: string; full_name: string; }


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
    sire_name: horse.sire_name ?? '',
    dam_name: horse.dam_name ?? '',
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
  const [associations, setAssociations] = useState<Association[]>([]);
  const [exhibitorNames, setExhibitorNames] = useState<ExhibitorName[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>(initialRegs);
  const [newReg, setNewReg] = useState({ association_id: '', registration_number: '' });
  const [regError, setRegError] = useState<string | null>(null);
  const [addingReg, setAddingReg] = useState(false);
  const [newRiderId, setNewRiderId] = useState('');
  const [addingRider, setAddingRider] = useState(false);
  const [riderError, setRiderError] = useState<string | null>(null);
  const [confirmRemoveRiderId, setConfirmRemoveRiderId] = useState<string | null>(null);
  const [open, setOpen] = useState({ details: true, riders: true, registrations: true });

  useEffect(() => {
    fetch('/api/breeds').then((r) => r.json()).then(setBreeds).catch(() => {});
    fetch('/api/horse-colors').then((r) => r.json()).then(setColors).catch(() => {});
    fetch('/api/associations').then((r) => r.json()).then(setAssociations).catch(() => {});
    fetch('/api/exhibitors/names').then((r) => r.json()).then(setExhibitorNames).catch(() => {});
    fetch(`/api/horses/${horse.id}/riders`).then((r) => r.json()).then(setRiders).catch(() => {});
  }, [horse.id]);

  const toggle = (k: keyof typeof open) => setOpen((p) => ({ ...p, [k]: !p[k] }));

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
        sire_name: form.sire_name.trim() || null,
        dam_name: form.dam_name.trim() || null,
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
    if (!newReg.association_id || !newReg.registration_number.trim()) {
      setRegError('Select an association and enter a registration number.');
      return;
    }
    const trimmed = newReg.registration_number.trim();
    setAddingReg(true);
    setRegError(null);

    const qs = new URLSearchParams({ association_id: newReg.association_id, registration_number: trimmed });
    const lookupRes = await fetch(`/api/horses/registrations/lookup?${qs.toString()}`);
    if (lookupRes.ok) {
      const existing = await lookupRes.json();
      if (existing.horse_id && existing.horse_id !== horse.id) {
        const st = associations.find((s) => s.id === newReg.association_id);
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
      body: JSON.stringify({ association_id: newReg.association_id, registration_number: trimmed }),
    });
    setAddingReg(false);
    if (res.ok) {
      const created = await res.json();
      setRegistrations((prev) => [...prev, created]);
      setNewReg({ association_id: '', registration_number: '' });
    } else {
      const err = await res.json().catch(() => ({}));
      setRegError(err.detail ?? 'Failed to add registration.');
    }
  };

  const handleDeleteReg = async (regId: string) => {
    const res = await fetch(`/api/horses/${horse.id}/registrations/${regId}`, { method: 'DELETE' });
    if (res.ok) setRegistrations((prev) => prev.filter((r) => r.id !== regId));
  };

  const handleAddRider = async () => {
    if (!newRiderId) { setRiderError('Select an exhibitor.'); return; }
    setAddingRider(true);
    setRiderError(null);
    const res = await fetch(`/api/horses/${horse.id}/riders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exhibitor_id: newRiderId }),
    });
    setAddingRider(false);
    if (res.ok) {
      const created = await res.json();
      setRiders((prev) => [...prev, created]);
      setNewRiderId('');
    } else {
      const err = await res.json().catch(() => ({}));
      setRiderError(err.detail ?? 'Failed to add rider.');
    }
  };

  const handleRemoveRider = async (exhibitorId: string) => {
    const res = await fetch(`/api/horses/${horse.id}/riders/${exhibitorId}`, { method: 'DELETE' });
    if (res.ok) setRiders((prev) => prev.filter((r) => r.exhibitor_id !== exhibitorId));
  };

  const usedAssociationIds = new Set(registrations.map((r) => r.association_id));
  const availableAssociations = associations.filter(
    (st) => !UNCERTIFIED_CODES.includes(st.code) && !usedAssociationIds.has(st.id)
  );

  // Parse year directly from the ISO string to avoid timezone shift on Jan 1 dates.
  const birthYear = form.foaling_date ? parseInt(form.foaling_date.split('-')[0], 10) : null;
  const displayAge = birthYear !== null ? Math.max(0, new Date().getFullYear() - birthYear) : horse.age;

  // Owner is always surfaced as a rider. Prepend them if absent from the fetched list.
  const displayRiders: Rider[] = (() => {
    if (!horse.owner_exhibitor_id || !horse.owner_exhibitor_name) return riders;
    if (riders.some((r) => r.exhibitor_id === horse.owner_exhibitor_id)) return riders;
    return [{ exhibitor_id: horse.owner_exhibitor_id, full_name: horse.owner_exhibitor_name }, ...riders];
  })();

  if (!isOwner) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border p-5 space-y-3" style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}>
          <SectionHeader title="Horse Details" open={open.details} onToggle={() => toggle('details')} />
          {open.details && (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div><dt className="text-xs uppercase tracking-wide" style={{ color: '#a89070' }}>Owner</dt><dd style={{ color: '#2c1810' }}>{horse.owner_exhibitor_name || horse.owner_name || '-'}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide" style={{ color: '#a89070' }}>Trainer</dt><dd style={{ color: '#2c1810' }}>{form.trainer_name || '-'}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide" style={{ color: '#a89070' }}>Sex</dt><dd style={{ color: '#2c1810' }}>{form.sex || '-'}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide" style={{ color: '#a89070' }}>Foaling Date</dt><dd style={{ color: '#2c1810' }}>{form.foaling_date || '-'}{displayAge !== null && displayAge !== undefined ? ` (show age ${displayAge})` : ''}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide" style={{ color: '#a89070' }}>Sire</dt><dd style={{ color: '#2c1810' }}>{form.sire_name || '-'}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide" style={{ color: '#a89070' }}>Dam</dt><dd style={{ color: '#2c1810' }}>{form.dam_name || '-'}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide" style={{ color: '#a89070' }}>Breeds</dt><dd style={{ color: '#2c1810' }}>{form.breed_ids.map((id) => breeds.find((b) => b.id === id)?.name).filter(Boolean).join(', ') || '-'}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide" style={{ color: '#a89070' }}>Color</dt><dd style={{ color: '#2c1810' }}>{colors.find((c) => c.id === form.color_id)?.name || '-'}</dd></div>
              {form.is_solid_paint_bred && (
                <div className="sm:col-span-2"><dd className="text-xs px-1.5 py-0.5 rounded inline-block font-semibold" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>Solid Paint-Bred (SPB)</dd></div>
              )}
            </dl>
          )}
        </div>

        <div className="rounded-lg border p-5 space-y-3" style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}>
          <SectionHeader title="Association Registrations" open={open.registrations} onToggle={() => toggle('registrations')} />
          {open.registrations && (
            registrations.length > 0 ? (
              <ul className="space-y-2">
                {registrations.map((r) => (
                  <li key={r.id} className="p-3 rounded border text-sm" style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0' }}>
                    <span className="font-mono font-semibold" style={{ color: '#8b4513' }}>{r.association_code}</span>
                    <span className="ml-2" style={{ color: '#2c1810' }}>{r.registration_number}</span>
                    <span className="text-xs ml-2" style={{ color: '#8b7355' }}>{r.association_name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm" style={{ color: '#8b7355' }}>No registrations on file.</p>
            )
          )}
        </div>

        <div className="rounded-lg border p-5 space-y-3" style={{ borderColor: '#d4b896' }}>
          <SectionHeader title="Rider(s)" open={open.riders} onToggle={() => toggle('riders')} />
          {open.riders && (
            displayRiders.length === 0
              ? <p className="text-sm" style={{ color: '#8b7355' }}>No riders linked.</p>
              : (
                <ul className="space-y-2">
                  {displayRiders.map((r) => (
                    <li key={r.exhibitor_id} className="flex items-center justify-between p-3 rounded border text-sm" style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0', color: '#2c1810' }}>
                      <span>{r.full_name}</span>
                      {horse.owner_exhibitor_id && r.exhibitor_id === horse.owner_exhibitor_id && (
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>Owner</span>
                      )}
                    </li>
                  ))}
                </ul>
              )
          )}
        </div>
      </div>
    );
  }

  // Helper used in the owner (editable) riders section below
  const riderIds = new Set(displayRiders.map((r) => r.exhibitor_id));
  const availableForRider = exhibitorNames.filter((e) => !riderIds.has(e.id));

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-5 space-y-4" style={{ borderColor: '#d4b896' }}>
        <SectionHeader title="Horse Details" open={open.details} onToggle={() => toggle('details')} />
        {open.details && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="text-sm block mb-1" style={{ color: '#8b7355' }}>Name *</label>
                <input name="name" value={form.name} onChange={handleChange} className="w-full border rounded px-3 py-2" />
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
                    <span className="ml-2 font-medium" style={{ color: '#8b4513' }}>(Show Age: {displayAge})</span>
                  )}
                </label>
                <input name="foaling_date" type="date" value={form.foaling_date} onChange={handleChange} className="w-full border rounded px-3 py-2" />
              </div>
              <div>
                <label className="text-sm block mb-1" style={{ color: '#8b7355' }}>Sire</label>
                <input name="sire_name" value={form.sire_name} onChange={handleChange} maxLength={200} placeholder="Registered name" className="w-full border rounded px-3 py-2" />
              </div>
              <div>
                <label className="text-sm block mb-1" style={{ color: '#8b7355' }}>Dam</label>
                <input name="dam_name" value={form.dam_name} onChange={handleChange} maxLength={200} placeholder="Registered name" className="w-full border rounded px-3 py-2" />
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
                <label htmlFor="spb_edit" className="text-sm" style={{ color: '#8b7355' }}>Solid Paint-Bred (SPB)</label>
              </div>
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}
            {saved && <p className="text-green-700 text-sm">Changes saved.</p>}

            <button onClick={handleSave} disabled={saving} className="px-5 py-2 rounded font-medium disabled:opacity-50" style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </>
        )}
      </div>

      <div className="rounded-lg border p-5 space-y-3" style={{ borderColor: '#d4b896' }}>
        <SectionHeader title="Rider(s)" open={open.riders} onToggle={() => toggle('riders')} />
        {open.riders && (
          <>
            {displayRiders.length === 0
              ? <p className="text-sm" style={{ color: '#8b7355' }}>No riders linked.</p>
              : (
                <ul className="space-y-2">
                  {displayRiders.map((r) => {
                    const isOwnerRow = horse.owner_exhibitor_id && r.exhibitor_id === horse.owner_exhibitor_id;
                    return (
                      <li key={r.exhibitor_id} className="flex items-center justify-between p-3 rounded border text-sm" style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0', color: '#2c1810' }}>
                        <span>{r.full_name}</span>
                        <div className="flex items-center gap-2">
                          {isOwnerRow && (
                            <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>Owner</span>
                          )}
                          {!isOwnerRow && (
                            <>
                              <button onClick={() => setConfirmRemoveRiderId(r.exhibitor_id)} className="text-xs text-red-600 hover:text-red-800">Remove</button>
                              {confirmRemoveRiderId === r.exhibitor_id && (
                                <span className="flex items-center gap-1">
                                  <span className="text-xs" style={{ color: '#2c1810' }}>Remove {r.full_name}?</span>
                                  <button onClick={() => { handleRemoveRider(r.exhibitor_id); setConfirmRemoveRiderId(null); }} className="text-xs text-red-700 font-semibold hover:text-red-900">Yes</button>
                                  <button onClick={() => setConfirmRemoveRiderId(null)} className="text-xs" style={{ color: '#8b7355' }}>Cancel</button>
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )
            }
            {availableForRider.length > 0 && (
              <div className="flex flex-wrap gap-2 items-end pt-1">
                <div className="flex-1 min-w-[200px]">
                  <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Add Rider</label>
                  <select value={newRiderId} onChange={(e) => setNewRiderId(e.target.value)} className="w-full border rounded px-3 py-2 text-sm">
                    <option value="">Select exhibitor...</option>
                    {availableForRider.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                  </select>
                </div>
                <button onClick={handleAddRider} disabled={addingRider} className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50" style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}>{addingRider ? 'Adding...' : 'Add'}</button>
              </div>
            )}
            {riderError && <p className="text-red-600 text-sm">{riderError}</p>}
          </>
        )}
      </div>

      <div className="rounded-lg border p-5 space-y-4" style={{ borderColor: '#d4b896' }}>
        <SectionHeader title="Breed Registrations &amp; Club Memberships" open={open.registrations} onToggle={() => toggle('registrations')} />
        {open.registrations && (
          <>
            {registrations.length > 0 ? (
              <ul className="space-y-2">
                {registrations.map((r) => (
                  <li key={r.id} className="flex items-center justify-between p-3 rounded border" style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0' }}>
                    <div>
                      <span className="font-mono text-sm font-semibold" style={{ color: '#8b4513' }}>{r.association_code}</span>
                      <span className="text-sm ml-2" style={{ color: '#2c1810' }}>{r.registration_number}</span>
                      <span className="text-xs ml-2" style={{ color: '#8b7355' }}>{r.association_name}</span>
                      <span className="ml-2"><AssociationTypeBadge type={r.association_type} /></span>
                    </div>
                    <button onClick={() => handleDeleteReg(r.id)} className="text-xs text-red-600 hover:text-red-800 ml-4 shrink-0">Remove</button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm" style={{ color: '#8b7355' }}>No registrations on file.</p>
            )}

            {availableAssociations.length > 0 && (
              <div className="flex flex-wrap gap-2 items-end pt-1">
                <div className="flex-1 min-w-[160px]">
                  <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Association</label>
                  <AssociationSelect
                    associations={availableAssociations}
                    value={newReg.association_id}
                    onChange={(association_id) => setNewReg((p) => ({ ...p, association_id }))}
                  />
                </div>
                <div className="flex-1 min-w-[160px]">
                  <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Registration / Member #</label>
                  <input value={newReg.registration_number} onChange={(e) => setNewReg((p) => ({ ...p, registration_number: e.target.value }))} placeholder="e.g. 1234567" className="w-full border rounded px-3 py-2 text-sm" />
                </div>
                <button onClick={handleAddReg} disabled={addingReg} className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50" style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}>
                  {addingReg ? 'Adding...' : 'Add'}
                </button>
              </div>
            )}
            {regError && <p className="text-red-600 text-sm">{regError}</p>}
          </>
        )}
      </div>
    </div>
  );
}
