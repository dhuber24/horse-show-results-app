'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmDialog from '@/components/ConfirmDialog';
import AssociationSelect, { AssociationTypeBadge, AssociationType } from '@/components/AssociationSelect';
import BreedCheckboxGroup from '@/components/BreedCheckboxGroup';
import HorseDocuments from '@/components/HorseDocuments';
import TrainerSelect from '@/components/TrainerSelect';
import SectionHeader from '@/components/SectionHeader';

interface Breed { id: string; name: string; }
interface HorseColor { id: string; name: string; }
interface HorsePattern { id: string; name: string; }
interface Exhibitor { id: string; full_name: string; }
interface Association { id: string; code: string; name: string; association_type: AssociationType; }
interface Registration { id: string; association_id: string; association_code: string; association_name: string; association_type: AssociationType; registration_number: string; }
interface Rider { exhibitor_id: string; full_name: string; }
interface Trainer { id: string; name: string; }

interface Horse {
  id: string;
  /** Registered (association) name — required. */
  name: string;
  /** Optional stable/call name. */
  barn_name: string | null;
  owner_exhibitor_id: string | null;
  owner_name: string | null;
  trainer_id: string | null;
  trainer_name: string | null;
  sire_name: string | null;
  dam_name: string | null;
  foaling_date: string | null;
  sex: string | null;
  breed_id: string | null;
  breed_ids?: string[];
  color_id: string | null;
  pattern_id: string | null;
  is_solid_paint_bred: boolean;
  age: number | null;
}

interface Props {
  horse: Horse;
  breeds: Breed[];
  colors: HorseColor[];
  patterns: HorsePattern[];
  exhibitors: Exhibitor[];
  associations: Association[];
  registrations: Registration[];
  trainers: Trainer[];
}



export default function EditHorseForm({ horse, breeds, colors, patterns, exhibitors, associations, registrations: initialRegs, trainers }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: horse.name,
    barn_name: horse.barn_name ?? '',
    owner_exhibitor_id: horse.owner_exhibitor_id ?? '',
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
    pattern_id: horse.pattern_id ?? '',
    is_solid_paint_bred: horse.is_solid_paint_bred,
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registrations, setRegistrations] = useState<Registration[]>(initialRegs);
  const [newReg, setNewReg] = useState({ association_id: '', registration_number: '' });
  const [addingReg, setAddingReg] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);
  const [confirmDeleteRegId, setConfirmDeleteRegId] = useState<string | null>(null);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [newRiderId, setNewRiderId] = useState('');
  const [addingRider, setAddingRider] = useState(false);
  const [riderError, setRiderError] = useState<string | null>(null);
  const [confirmRemoveRiderId, setConfirmRemoveRiderId] = useState<string | null>(null);
  const [open, setOpen] = useState({ details: true, riders: true, registrations: true, documents: true });

  useEffect(() => {
    fetch(`/api/horses/${horse.id}/riders`).then((r) => r.json()).then(setRiders).catch(() => {});
  }, [horse.id]);

  const toggle = (k: keyof typeof open) => setOpen((p) => ({ ...p, [k]: !p[k] }));

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Registered name is required.'); return; }
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
      barn_name: form.barn_name.trim() || null,
      owner_exhibitor_id: form.owner_exhibitor_id || null,
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
      pattern_id: form.pattern_id || null,
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
        setRegError(`${st?.code ?? 'Registration'} #${trimmed} is already on file for horse "${existing.horse_name}"${owner}.`);
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
  const availableAssociations = associations.filter((a) => !usedAssociationIds.has(a.id));

  // Parse year directly from the ISO string to avoid the JS UTC-to-local timezone shift
  // that moves Jan 1 dates to Dec 31 of the prior year for users west of UTC.
  const birthYear = form.foaling_date ? parseInt(form.foaling_date.split('-')[0], 10) : null;
  const displayAge = birthYear !== null ? Math.max(0, new Date().getFullYear() - birthYear) : horse.age;

  // Owner is always surfaced as a rider. Prepend them if the backend riders list omits them
  // (e.g. when they haven't entered any classes yet).
  const ownerExhibitor = form.owner_exhibitor_id
    ? exhibitors.find((e) => e.id === form.owner_exhibitor_id) ?? null
    : null;
  const displayRiders: Rider[] = (() => {
    if (!ownerExhibitor) return riders;
    if (riders.some((r) => r.exhibitor_id === ownerExhibitor.id)) return riders;
    return [{ exhibitor_id: ownerExhibitor.id, full_name: ownerExhibitor.full_name }, ...riders];
  })();

  return (
    <div className="space-y-6">
      <div className="border rounded-lg p-4 space-y-4" style={{ borderColor: '#d4b896' }}>
        <SectionHeader title="Horse Details" open={open.details} onToggle={() => toggle('details')} />
        {open.details && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="text-sm block mb-1" style={{ color: '#8b7355' }}>Registered Name *</label>
                <input name="name" value={form.name} onChange={handleChange} maxLength={200} className="w-full border rounded px-3 py-2" />
                <label className="text-sm block mb-1 mt-3" style={{ color: '#8b7355' }}>Barn Name</label>
                <input name="barn_name" value={form.barn_name} onChange={handleChange} maxLength={200} placeholder="Stable or call name" className="w-full border rounded px-3 py-2" />
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
              <div>
                <label className="text-sm block mb-1" style={{ color: '#8b7355' }}>Pattern</label>
                <select name="pattern_id" value={form.pattern_id} onChange={handleChange} className="w-full border rounded px-3 py-2">
                  <option value="">- Not specified -</option>
                  {patterns.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex items-center justify-between pt-1">
              <button onClick={handleSave} disabled={saving} className="px-5 py-2 rounded font-medium disabled:opacity-50" style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}>{saving ? 'Saving...' : 'Save Changes'}</button>
              <button onClick={() => setConfirmDelete(true)} className="text-sm text-red-600 hover:text-red-800">Delete Horse</button>
            </div>
            {confirmDelete && <ConfirmDialog title="Delete Horse" message={`Delete ${form.name}? This cannot be undone.`} confirmLabel="Yes, delete" destructive confirming={deleting} onConfirm={handleDelete} onCancel={() => setConfirmDelete(false)} />}
          </>
        )}
      </div>

      <div className="border rounded-lg p-4 space-y-4" style={{ borderColor: '#d4b896' }}>
        <SectionHeader title="Riders" open={open.riders} onToggle={() => toggle('riders')} />
        {open.riders && (
          <>
            {displayRiders.length === 0
              ? <p className="text-sm" style={{ color: '#8b7355' }}>No riders linked.</p>
              : (
                <ul className="space-y-2">
                  {displayRiders.map((r) => {
                    const isOwnerRow = ownerExhibitor && r.exhibitor_id === ownerExhibitor.id;
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
                                <ConfirmDialog
                                  title="Remove Rider"
                                  message={`Remove ${r.full_name} as a rider?`}
                                  confirmLabel="Yes, remove"
                                  destructive
                                  onConfirm={() => { handleRemoveRider(r.exhibitor_id); setConfirmRemoveRiderId(null); }}
                                  onCancel={() => setConfirmRemoveRiderId(null)}
                                />
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
            {(() => {
              const riderIds = new Set(displayRiders.map((r) => r.exhibitor_id));
              const available = exhibitors.filter((e) => !riderIds.has(e.id));
              if (available.length === 0) return null;
              return (
                <div className="flex flex-wrap gap-2 items-end pt-1">
                  <div className="flex-1 min-w-[200px]">
                    <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Add Rider</label>
                    <select value={newRiderId} onChange={(e) => setNewRiderId(e.target.value)} className="w-full border rounded px-3 py-2 text-sm">
                      <option value="">Select exhibitor...</option>
                      {available.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                    </select>
                  </div>
                  <button onClick={handleAddRider} disabled={addingRider} className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50" style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}>{addingRider ? 'Adding...' : 'Add'}</button>
                </div>
              );
            })()}
            {riderError && <p className="text-red-600 text-sm">{riderError}</p>}
          </>
        )}
      </div>

      <div className="border rounded-lg p-4 space-y-4" style={{ borderColor: '#d4b896' }}>
        <SectionHeader title="Association Registration Numbers" open={open.registrations} onToggle={() => toggle('registrations')} />
        {open.registrations && (
          <>
            {registrations.length > 0 ? (
              <ul className="space-y-2">
                {registrations.map((r) => (
                  <li key={r.id} className="flex items-center justify-between p-3 rounded border" style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0' }}>
                    <div className="flex items-center gap-2"><span className="font-mono text-sm font-semibold" style={{ color: '#8b4513' }}>{r.association_code}</span><span className="text-sm" style={{ color: '#2c1810' }}>{r.registration_number}</span><AssociationTypeBadge type={r.association_type} /></div>
                    <button onClick={() => setConfirmDeleteRegId(r.id)} className="text-xs text-red-600 hover:text-red-800 ml-4 shrink-0">Remove</button>
                    {confirmDeleteRegId === r.id && <ConfirmDialog title="Remove Registration" message={`Remove ${r.association_code} registration? This cannot be undone.`} confirmLabel="Yes, remove" destructive onConfirm={() => { handleDeleteReg(r.id); setConfirmDeleteRegId(null); }} onCancel={() => setConfirmDeleteRegId(null)} />}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm" style={{ color: '#8b7355' }}>No registrations on file.</p>}
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
                <button onClick={handleAddReg} disabled={addingReg} className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50" style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}>{addingReg ? 'Adding...' : 'Add'}</button>
              </div>
            )}
            {regError && <p className="text-red-600 text-sm">{regError}</p>}
          </>
        )}
      </div>

      <div className="border rounded-lg p-4 space-y-4" style={{ borderColor: '#d4b896' }}>
        <SectionHeader title="Health & Registration Documents" open={open.documents} onToggle={() => toggle('documents')} />
        {open.documents && <HorseDocuments horseId={horse.id} />}
      </div>
    </div>
  );
}
