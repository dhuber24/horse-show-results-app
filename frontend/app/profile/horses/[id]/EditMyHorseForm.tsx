'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import BreedCheckboxGroup from '@/components/BreedCheckboxGroup';
import TrainerSelect from '@/components/TrainerSelect';
import AssociationSelect, { AssociationTypeBadge, AssociationType } from '@/components/AssociationSelect';
import HorseDocuments, {
  HorseDocument,
  HEALTH_DOC_TYPES,
  REGISTRATION_DOC_TYPES,
} from '@/components/HorseDocuments';

interface Breed { id: string; name: string; }
interface HorseColor { id: string; name: string; }
interface Association { id: string; code: string; name: string; association_type: AssociationType; }
interface Registration { id: string; association_id: string; association_code: string; association_name: string; association_type: AssociationType; registration_number: string; }
interface Rider { exhibitor_id: string; full_name: string; }
interface ExhibitorName { id: string; full_name: string; }

interface Horse {
  id: string;
  /** Registered (association) name — required. */
  name: string;
  /** Optional stable/call name. */
  barn_name: string | null;
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

/** The page is a tab set; `?section=` deep-links to one tab. */
export type HorseSectionKey = 'details' | 'people' | 'health' | 'associations';

/** Which form fields each Save button is responsible for. */
type SaveOrigin = 'details' | 'people';

interface Props {
  horse: Horse;
  registrations: Registration[];
  documents: HorseDocument[];
  isOwner: boolean;
  initialSection?: HorseSectionKey;
}

const TABS: { key: HorseSectionKey; label: string; ownerOnly?: boolean }[] = [
  { key: 'details', label: 'Details' },
  { key: 'people', label: 'People' },
  // Documents are only returned by the API for the owner, so non-owners get no tab.
  { key: 'health', label: 'Health', ownerOnly: true },
  { key: 'associations', label: 'Associations' },
];

const CARD_STYLE = { borderColor: '#d4b896', backgroundColor: '#ffffff' };
const ROW_STYLE = { borderColor: '#e8d5b7', backgroundColor: '#faf6f0' };
const PRIMARY_BUTTON = { backgroundColor: '#2c1810', color: '#f5ede0' };
const OWNER_BADGE = { backgroundColor: '#fef3c7', color: '#92400e' };

function ReadOnlyField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide" style={{ color: '#a89070' }}>{label}</dt>
      <dd style={{ color: '#2c1810' }}>{value || '-'}</dd>
    </div>
  );
}

function PanelIntro({ children }: { children: React.ReactNode }) {
  return <p className="text-sm" style={{ color: '#8b7355' }}>{children}</p>;
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#a89070' }}>{children}</p>
  );
}

function RegistrationRow({ reg, onRemove }: { reg: Registration; onRemove?: () => void }) {
  return (
    <li className="flex items-center justify-between p-3 rounded border" style={ROW_STYLE}>
      <div>
        <span className="font-mono text-sm font-semibold" style={{ color: '#8b4513' }}>{reg.association_code}</span>
        <span className="text-sm ml-2" style={{ color: '#2c1810' }}>{reg.registration_number}</span>
        <span className="text-xs ml-2" style={{ color: '#8b7355' }}>{reg.association_name}</span>
        <span className="ml-2"><AssociationTypeBadge type={reg.association_type} /></span>
      </div>
      {onRemove && (
        <button onClick={onRemove} className="text-xs text-red-600 hover:text-red-800 ml-4 shrink-0">Remove</button>
      )}
    </li>
  );
}

function TabPanel({ id, active, children }: { id: HorseSectionKey; active: boolean; children: React.ReactNode }) {
  return (
    <div
      role="tabpanel"
      id={`panel-${id}`}
      aria-labelledby={`tab-${id}`}
      hidden={!active}
      tabIndex={0}
      /* Inactive panels stay mounted so switching tabs never discards a
         half-filled upload form or a document that was just added. */
      className={active ? 'rounded-lg border p-5 space-y-4' : 'hidden'}
      style={CARD_STYLE}
    >
      {children}
    </div>
  );
}

export default function EditMyHorseForm({
  horse,
  registrations: initialRegs,
  documents,
  isOwner,
  initialSection,
}: Props) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: horse.name,
    barn_name: horse.barn_name ?? '',
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
  // Details and People edit one horse record but have their own Save button, so
  // status lands in the tab the user actually clicked in.
  const [saveOrigin, setSaveOrigin] = useState<SaveOrigin | null>(null);
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

  const tabs = TABS.filter((t) => !t.ownerOnly || isOwner);
  // A `?section=` pointing at a tab this viewer can't see falls back to Details.
  const [activeTab, setActiveTab] = useState<HorseSectionKey>(
    initialSection && tabs.some((t) => t.key === initialSection) ? initialSection : 'details'
  );

  useEffect(() => {
    fetch('/api/breeds').then((r) => r.json()).then(setBreeds).catch(() => {});
    fetch('/api/horse-colors').then((r) => r.json()).then(setColors).catch(() => {});
    fetch('/api/associations').then((r) => r.json()).then(setAssociations).catch(() => {});
    fetch('/api/exhibitors/names').then((r) => r.json()).then(setExhibitorNames).catch(() => {});
    fetch(`/api/horses/${horse.id}/riders`).then((r) => r.json()).then(setRiders).catch(() => {});
  }, [horse.id]);

  const selectTab = (key: HorseSectionKey) => {
    setActiveTab(key);
    document.getElementById(`tab-${key}`)?.focus();
  };

  // role="tablist" promises arrow-key navigation, so honour it.
  const handleTabKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.key === activeTab);
    if (e.key === 'ArrowRight') { e.preventDefault(); selectTab(tabs[(i + 1) % tabs.length].key); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); selectTab(tabs[(i - 1 + tabs.length) % tabs.length].key); }
    else if (e.key === 'Home') { e.preventDefault(); selectTab(tabs[0].key); }
    else if (e.key === 'End') { e.preventDefault(); selectTab(tabs[tabs.length - 1].key); }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSave = async (origin: SaveOrigin) => {
    setSaveOrigin(origin);
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
    setSaved(false);
    const res = await fetch(`/api/horses/${horse.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(),
        barn_name: form.barn_name.trim() || null,
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

    // The lookup answers 200 = already on file for some horse, 404 = clear.
    // Anything else means the check never ran, so refuse rather than fail open
    // and silently accept a number that may belong to another horse.
    const qs = new URLSearchParams({ association_id: newReg.association_id, registration_number: trimmed });
    let lookupRes: Response;
    try {
      lookupRes = await fetch(`/api/horses/registrations/lookup?${qs.toString()}`);
    } catch {
      setRegError('Could not check whether that number is already on file. Check your connection and try again.');
      setAddingReg(false);
      return;
    }
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
    } else if (lookupRes.status !== 404) {
      setRegError('Could not check whether that number is already on file. Try again in a moment.');
      setAddingReg(false);
      return;
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
  const availableAssociations = associations.filter((st) => !usedAssociationIds.has(st.id));

  // Parse year directly from the ISO string to avoid timezone shift on Jan 1 dates.
  const birthYear = form.foaling_date ? parseInt(form.foaling_date.split('-')[0], 10) : null;
  const displayAge = birthYear !== null ? Math.max(0, new Date().getFullYear() - birthYear) : horse.age;

  // Owner is always surfaced as a rider. Prepend them if absent from the fetched list.
  const displayRiders: Rider[] = (() => {
    if (!horse.owner_exhibitor_id || !horse.owner_exhibitor_name) return riders;
    if (riders.some((r) => r.exhibitor_id === horse.owner_exhibitor_id)) return riders;
    return [{ exhibitor_id: horse.owner_exhibitor_id, full_name: horse.owner_exhibitor_name }, ...riders];
  })();

  const riderIds = new Set(displayRiders.map((r) => r.exhibitor_id));
  const availableForRider = exhibitorNames.filter((e) => !riderIds.has(e.id));
  const ownerLabel = horse.owner_exhibitor_name || horse.owner_name;

  const saveRow = (origin: SaveOrigin) => (
    <div className="space-y-2">
      {saveOrigin === origin && error && <p className="text-red-600 text-sm">{error}</p>}
      {saveOrigin === origin && saved && <p className="text-green-700 text-sm">Changes saved.</p>}
      <button
        onClick={() => handleSave(origin)}
        disabled={saving}
        className="px-5 py-2 rounded font-medium disabled:opacity-50"
        style={PRIMARY_BUTTON}
      >
        {saving && saveOrigin === origin ? 'Saving...' : 'Save Changes'}
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Horse record sections"
        onKeyDown={handleTabKeys}
        className="flex border-b overflow-x-auto"
        style={{ borderColor: '#d4b896' }}
      >
        {tabs.map((t) => {
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              id={`tab-${t.key}`}
              role="tab"
              aria-selected={active}
              aria-controls={`panel-${t.key}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setActiveTab(t.key)}
              className="px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors"
              style={{
                color: active ? '#2c1810' : '#8b7355',
                borderBottom: active ? '2px solid #8b4513' : '2px solid transparent',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Details — who the horse is. */}
      <TabPanel id="details" active={activeTab === 'details'}>
        {isOwner ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="text-sm block mb-1" style={{ color: '#8b7355' }}>Registered Name *</label>
                <input name="name" value={form.name} onChange={handleChange} maxLength={200} className="w-full border rounded px-3 py-2" />
                <p className="text-xs mt-1" style={{ color: '#a89070' }}>
                  What the horse is entered and published under.
                </p>
              </div>
              <div className="sm:col-span-2">
                <label className="text-sm block mb-1" style={{ color: '#8b7355' }}>Barn Name</label>
                <input name="barn_name" value={form.barn_name} onChange={handleChange} maxLength={200} placeholder="Stable or call name" className="w-full border rounded px-3 py-2" />
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
            {saveRow('details')}
          </>
        ) : (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <ReadOnlyField label="Barn Name" value={form.barn_name} />
            <ReadOnlyField label="Sex" value={form.sex} />
            <ReadOnlyField
              label="Foaling Date"
              value={form.foaling_date
                ? `${form.foaling_date}${displayAge !== null && displayAge !== undefined ? ` (show age ${displayAge})` : ''}`
                : null}
            />
            <ReadOnlyField label="Sire" value={form.sire_name} />
            <ReadOnlyField label="Dam" value={form.dam_name} />
            <ReadOnlyField
              label="Breeds"
              value={form.breed_ids.map((id) => breeds.find((b) => b.id === id)?.name).filter(Boolean).join(', ')}
            />
            <ReadOnlyField label="Color" value={colors.find((c) => c.id === form.color_id)?.name} />
            {form.is_solid_paint_bred && (
              <div className="sm:col-span-2">
                <dd className="text-xs px-1.5 py-0.5 rounded inline-block font-semibold" style={OWNER_BADGE}>
                  Solid Paint-Bred (SPB)
                </dd>
              </div>
            )}
          </dl>
        )}
      </TabPanel>

      {/* People — everyone attached to the horse, in one place. */}
      <TabPanel id="people" active={activeTab === 'people'}>
        <PanelIntro>Owner, trainer, and the riders who show this horse.</PanelIntro>

        <dl className="text-sm">
          <ReadOnlyField label="Owner" value={ownerLabel} />
        </dl>

        <div>
          <label className="text-sm block mb-1" style={{ color: '#8b7355' }}>Trainer</label>
          {isOwner ? (
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
          ) : (
            <p style={{ color: '#2c1810' }}>{form.trainer_name || '-'}</p>
          )}
        </div>

        <div className="space-y-2 border-t pt-4" style={{ borderColor: '#f0e4d0' }}>
          <SubHeading>Rider(s)</SubHeading>
          {displayRiders.length === 0 ? (
            <p className="text-sm" style={{ color: '#8b7355' }}>No riders linked.</p>
          ) : (
            <ul className="space-y-2">
              {displayRiders.map((r) => {
                const isOwnerRow = horse.owner_exhibitor_id && r.exhibitor_id === horse.owner_exhibitor_id;
                return (
                  <li key={r.exhibitor_id} className="flex items-center justify-between p-3 rounded border text-sm" style={{ ...ROW_STYLE, color: '#2c1810' }}>
                    <span>{r.full_name}</span>
                    <div className="flex items-center gap-2">
                      {isOwnerRow && (
                        <span className="text-xs px-1.5 py-0.5 rounded" style={OWNER_BADGE}>Owner</span>
                      )}
                      {isOwner && !isOwnerRow && (
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
          )}
          {isOwner && availableForRider.length > 0 && (
            <div className="flex flex-wrap gap-2 items-end pt-1">
              <div className="flex-1 min-w-[200px]">
                <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Add Rider</label>
                <select value={newRiderId} onChange={(e) => setNewRiderId(e.target.value)} className="w-full border rounded px-3 py-2 text-sm">
                  <option value="">Select exhibitor...</option>
                  {availableForRider.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select>
              </div>
              <button onClick={handleAddRider} disabled={addingRider} className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50" style={PRIMARY_BUTTON}>
                {addingRider ? 'Adding...' : 'Add'}
              </button>
            </div>
          )}
          {riderError && <p className="text-red-600 text-sm">{riderError}</p>}
        </div>

        {isOwner && saveRow('people')}
      </TabPanel>

      {/* Health — travel and competition paperwork. Owner-only data. */}
      {isOwner && (
        <TabPanel id="health" active={activeTab === 'health'}>
          <PanelIntro>
            Coggins, vaccination records, and health certificates. Shows check these before the horse ships in.
          </PanelIntro>
          <HorseDocuments
            horseId={horse.id}
            initialDocuments={documents}
            types={HEALTH_DOC_TYPES}
            emptyLabel="No health documents on file."
            uploadLabel="+ Upload Health Document"
          />
        </TabPanel>
      )}

      {/* Associations — the numbers, plus the papers backing them. */}
      <TabPanel id="associations" active={activeTab === 'associations'}>
        <PanelIntro>Breed registrations and club memberships carried by this horse.</PanelIntro>

        {registrations.length > 0 ? (
          <ul className="space-y-2">
            {registrations.map((r) => (
              <RegistrationRow
                key={r.id}
                reg={r}
                onRemove={isOwner ? () => handleDeleteReg(r.id) : undefined}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm" style={{ color: '#8b7355' }}>No registrations on file.</p>
        )}

        {isOwner && availableAssociations.length > 0 && (
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
            <button onClick={handleAddReg} disabled={addingReg} className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50" style={PRIMARY_BUTTON}>
              {addingReg ? 'Adding...' : 'Add'}
            </button>
          </div>
        )}
        {regError && <p className="text-red-600 text-sm">{regError}</p>}

        {isOwner && (
          <div className="border-t pt-4 space-y-3" style={{ borderColor: '#f0e4d0' }}>
            <SubHeading>Registration Papers</SubHeading>
            <PanelIntro>
              Scans of the registration certificates and membership cards behind the numbers above.
            </PanelIntro>
            <HorseDocuments
              horseId={horse.id}
              initialDocuments={documents}
              types={REGISTRATION_DOC_TYPES}
              emptyLabel="No registration papers on file."
              uploadLabel="+ Upload Registration Paper"
            />
          </div>
        )}
      </TabPanel>
    </div>
  );
}
