'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import BreedCheckboxGroup from '@/components/BreedCheckboxGroup';
import TrainerSelect from '@/components/TrainerSelect';

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
  breed_names?: string[];
  color_name: string | null;
  is_solid_paint_bred: boolean;
  owner_exhibitor_id: string | null;
  created_by_exhibitor_id: string | null;
}

interface LookupMatch {
  horse_id: string;
  horse_name: string;
  owner_name: string | null;
}

interface Props {
  exhibitorId: string;
  initialHorses: Horse[];
}

type OwnerMode = 'self' | 'existing' | 'new';

const UNCERTIFIED_CODES = ['OPEN'];
const emptyForm = { name: '', trainer_id: '', trainer_name: '', trainer_first_name: '', trainer_last_name: '', trainer_email: '', sex: '', foaling_date: '', breed_ids: [] as string[], color_id: '', is_solid_paint_bred: false };
const emptyOwner = { mode: 'self' as OwnerMode, exhibitorId: '', firstName: '', lastName: '', email: '' };

export default function MyHorsesPanel({ exhibitorId, initialHorses }: Props) {
  const [horses, setHorses] = useState<Horse[]>(initialHorses);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [breeds, setBreeds] = useState<Breed[]>([]);
  const [colors, setColors] = useState<HorseColor[]>([]);
  const [showTypes, setShowTypes] = useState<ShowType[]>([]);

  const [owner, setOwner] = useState(emptyOwner);
  const [exhibitorList, setExhibitorList] = useState<{ id: string; full_name: string }[]>([]);
  const [loadingExhibitors, setLoadingExhibitors] = useState(false);

  const [pendingRegs, setPendingRegs] = useState<PendingReg[]>([]);
  const [newReg, setNewReg] = useState({ show_type_id: '', registration_number: '' });
  const [regError, setRegError] = useState<string | null>(null);

  // "Find existing horse" search panel state
  const [showSearch, setShowSearch] = useState(false);
  const [searchInput, setSearchInput] = useState({ show_type_id: '', registration_number: '' });
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<LookupMatch | null>(null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [notFoundSearch, setNotFoundSearch] = useState(false);
  const [linking, setLinking] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [confirmUnlinkId, setConfirmUnlinkId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/breeds').then((r) => r.json()).then(setBreeds).catch(() => {});
    fetch('/api/horse-colors').then((r) => r.json()).then(setColors).catch(() => {});
    fetch('/api/show-types').then((r) => r.json()).then(setShowTypes).catch(() => {});
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleOwnerMode = async (mode: OwnerMode) => {
    setOwner((prev) => ({ ...prev, mode }));
    if (mode === 'existing' && exhibitorList.length === 0) {
      setLoadingExhibitors(true);
      try {
        const res = await fetch('/api/exhibitors/names');
        if (res.ok) setExhibitorList(await res.json());
      } finally {
        setLoadingExhibitors(false);
      }
    }
  };

  const handleAddReg = async () => {
    if (!newReg.show_type_id || !newReg.registration_number.trim()) {
      setRegError('Select an association and enter a registration number.');
      return;
    }
    const trimmed = newReg.registration_number.trim();
    const st = showTypes.find((s) => s.id === newReg.show_type_id)!;

    // Check if this registration number is already on file for another horse
    const qs = new URLSearchParams({ show_type_id: newReg.show_type_id, registration_number: trimmed });
    const lookupRes = await fetch(`/api/horses/registrations/lookup?${qs.toString()}`);
    if (lookupRes.ok) {
      const existing = await lookupRes.json();
      const owner = existing.owner_name ? ` (owner: ${existing.owner_name})` : '';
      setRegError(
        `${st.code} #${trimmed} is already on file for horse "${existing.horse_name}"${owner}. ` +
        `If this is the same horse, contact your show secretary.`
      );
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

  const handleAdd = async () => {
    if (!form.name.trim()) { setError('Horse name is required.'); return; }
    if (owner.mode === 'existing' && !owner.exhibitorId) {
      setError('Select an existing owner from the list.');
      return;
    }
    if (owner.mode === 'new') {
      if (!owner.firstName.trim() || !owner.lastName.trim() || !owner.email.trim()) {
        setError('Owner first name, last name, and email are all required.');
        return;
      }
    }
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
      is_solid_paint_bred: form.is_solid_paint_bred,
      claim_ownership: owner.mode === 'self',
      ...(owner.mode === 'existing' && { owner_exhibitor_id: owner.exhibitorId }),
      ...(owner.mode === 'new' && {
        owner_first_name: owner.firstName.trim(),
        owner_last_name: owner.lastName.trim(),
        owner_email: owner.email.trim(),
      }),
      registrations: pendingRegs.map((r) => ({
        show_type_id: r.show_type_id,
        registration_number: r.registration_number,
      })),
    };
    body.trainer_id = form.trainer_id || null;
    body.trainer_name = form.trainer_name.trim() || null;
    body.trainer_first_name = form.trainer_first_name.trim() || null;
    body.trainer_last_name = form.trainer_last_name.trim() || null;
    body.trainer_email = form.trainer_email.trim() || null;
    if (form.sex) body.sex = form.sex;
    if (form.foaling_date) body.foaling_date = form.foaling_date;
    body.breed_ids = form.breed_ids;
    if (form.color_id) body.color_id = form.color_id;

    const res = await fetch(`/api/exhibitors/${exhibitorId}/created-horses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to add horse.');
      return;
    }

    const created = await res.json();
    setHorses((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    setForm(emptyForm);
    setOwner(emptyOwner);
    setPendingRegs([]);
    setShowForm(false);
  };

  const handleSearch = async () => {
    if (!searchInput.show_type_id || !searchInput.registration_number.trim()) {
      setSearchMessage('Select an association and enter a registration number.');
      setSearchResult(null);
      return;
    }
    setSearching(true);
    setSearchMessage(null);
    setSearchResult(null);
    const qs = new URLSearchParams({
      show_type_id: searchInput.show_type_id,
      registration_number: searchInput.registration_number.trim(),
    });
    const res = await fetch(`/api/horses/registrations/lookup?${qs.toString()}`);
    setSearching(false);

    if (res.ok) {
      const match: LookupMatch = await res.json();
      if (horses.some((h) => h.id === match.horse_id)) {
        setSearchMessage(`"${match.horse_name}" is already on your profile.`);
        setNotFoundSearch(false);
        return;
      }
      setSearchResult(match);
      setNotFoundSearch(false);
    } else if (res.status === 404) {
      setSearchMessage('No horse found with that registration.');
      setNotFoundSearch(true);
    } else {
      setSearchMessage('Search failed. Try again.');
      setNotFoundSearch(false);
    }
  };

  const handleCreateFromSearch = () => {
    const st = showTypes.find((s) => s.id === searchInput.show_type_id);
    if (st && searchInput.registration_number.trim()) {
      setPendingRegs([{
        show_type_id: st.id,
        show_type_code: st.code,
        show_type_name: st.name,
        registration_number: searchInput.registration_number.trim(),
      }]);
    }
    setShowSearch(false);
    setSearchInput({ show_type_id: '', registration_number: '' });
    setSearchResult(null);
    setSearchMessage(null);
    setNotFoundSearch(false);
    setShowForm(true);
  };

  const handleLink = async () => {
    if (!searchResult) return;
    setLinking(true);
    const res = await fetch(`/api/exhibitors/${exhibitorId}/linked-horses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ horse_id: searchResult.horse_id }),
    });
    setLinking(false);
    if (res.ok) {
      const linked: Horse = await res.json();
      setHorses((prev) => [...prev, linked].sort((a, b) => a.name.localeCompare(b.name)));
      setSearchResult(null);
      setSearchInput({ show_type_id: '', registration_number: '' });
      setSearchMessage(null);
      setShowSearch(false);
    } else {
      const err = await res.json().catch(() => ({}));
      setSearchMessage(err.detail ?? 'Failed to add horse to your profile.');
    }
  };

  const handleRemoveFromProfile = async (horse: Horse) => {
    const isCreator = horse.created_by_exhibitor_id === exhibitorId;
    const url = isCreator
      ? `/api/exhibitors/${exhibitorId}/created-horses/${horse.id}`
      : `/api/exhibitors/${exhibitorId}/linked-horses/${horse.id}`;
    setUnlinkingId(horse.id);
    const res = await fetch(url, { method: 'DELETE' });
    setUnlinkingId(null);
    if (res.ok || res.status === 204) {
      setHorses((prev) => prev.filter((h) => h.id !== horse.id));
    }
    setConfirmUnlinkId(null);
  };

  const usedShowTypeIds = new Set(pendingRegs.map((r) => r.show_type_id));
  const availableShowTypes = showTypes.filter(
    (st) => !UNCERTIFIED_CODES.includes(st.code) && !usedShowTypeIds.has(st.id)
  );

  const searchableShowTypes = showTypes.filter((st) => !UNCERTIFIED_CODES.includes(st.code));

  return (
    <div className="space-y-4">
      {horses.length === 0 && !showForm && !showSearch ? (
        <p className="text-sm" style={{ color: '#8b7355' }}>No horses on your profile yet.</p>
      ) : (
        <ul className="divide-y" style={{ borderColor: '#f0e4d0' }}>
          {horses.map((horse) => {
            const isOwner = horse.owner_exhibitor_id === exhibitorId;
            const isCreator = horse.created_by_exhibitor_id === exhibitorId;
            const badgeLabel = isOwner ? 'Owner' : isCreator ? 'Created' : 'Linked';
            const badgeStyle = isOwner
              ? { backgroundColor: '#fef3c7', color: '#92400e' }
              : isCreator
                ? { backgroundColor: '#dcfce7', color: '#166534' }
                : { backgroundColor: '#e0e7ff', color: '#3730a3' };
            return (
              <li key={horse.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3">
                  <div>
                    <div className="font-medium text-sm flex items-center flex-wrap gap-1.5" style={{ color: '#2c1810' }}>
                      {horse.name}
                      {horse.sex && (
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#f5ede0', color: '#8b4513' }}>
                          {horse.sex}
                        </span>
                      )}
                      {horse.is_solid_paint_bred && (
                        <span className="text-xs px-1.5 py-0.5 rounded font-semibold" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
                          SPB
                        </span>
                      )}
                      <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={badgeStyle}>
                        {badgeLabel}
                      </span>
                    </div>
                    <div className="text-xs mt-0.5 flex gap-x-2" style={{ color: '#8b7355' }}>
                      {(horse.breed_names?.length ? horse.breed_names.join(', ') : horse.breed_name) && (
                        <span>{horse.breed_names?.length ? horse.breed_names.join(', ') : horse.breed_name}</span>
                      )}
                      {horse.color_name && <span>{horse.color_name}</span>}
                      {horse.age !== null && horse.age !== undefined && <span>Age: {horse.age}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 ml-4 shrink-0">
                  {isOwner && (
                    <>
                      <Link
                        href={`/profile/horses/${horse.id}`}
                        className="text-xs font-medium hover:underline"
                        style={{ color: '#8b4513' }}
                      >
                        Edit
                      </Link>
                      <Link
                        href={`/profile/horses/${horse.id}?section=documents`}
                        className="text-xs font-medium hover:underline"
                        style={{ color: '#8b4513' }}
                      >
                        Documents
                      </Link>
                    </>
                  )}
                  {!isOwner && (
                    <Link
                      href={`/profile/horses/${horse.id}`}
                      className="text-xs font-medium hover:underline"
                      style={{ color: '#8b4513' }}
                    >
                      View
                    </Link>
                  )}
                  {confirmUnlinkId === horse.id ? (
                    <span className="flex items-center gap-2">
                      <span className="text-xs" style={{ color: '#5c3d1e' }}>Remove from profile?</span>
                      <button
                        onClick={() => handleRemoveFromProfile(horse)}
                        disabled={unlinkingId === horse.id}
                        className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                      >
                        {unlinkingId === horse.id ? 'Removing...' : 'Yes'}
                      </button>
                      <button
                        onClick={() => setConfirmUnlinkId(null)}
                        className="text-xs hover:underline"
                        style={{ color: '#8b7355' }}
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirmUnlinkId(horse.id)}
                      className="text-xs text-red-600 hover:text-red-800"
                      title={isCreator ? 'Remove from profile (horse is kept in the system)' : undefined}
                    >
                      Remove from profile
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Find existing horse */}
      {showSearch && (
        <div className="border rounded-lg p-4 space-y-3" style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}>
          <h3 className="text-sm font-semibold" style={{ color: '#2c1810' }}>Find an Existing Horse</h3>
          <p className="text-xs" style={{ color: '#8b7355' }}>
            If a horse is already in the system, you can add it to your profile by association registration number.
          </p>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[140px]">
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Association</label>
              <select
                value={searchInput.show_type_id}
                onChange={(e) => setSearchInput((p) => ({ ...p, show_type_id: e.target.value }))}
                className="w-full border rounded px-3 py-2 text-sm"
              >
                <option value="">Select...</option>
                {searchableShowTypes.map((st) => (
                  <option key={st.id} value={st.id}>{st.code} - {st.name}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Registration #</label>
              <input
                value={searchInput.registration_number}
                onChange={(e) => setSearchInput((p) => ({ ...p, registration_number: e.target.value }))}
                placeholder="e.g. 1234567"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={searching}
              className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
            >
              {searching ? 'Searching...' : 'Search'}
            </button>
          </div>

          {searchResult && (
            <div className="rounded p-3 border" style={{ borderColor: '#86efac', backgroundColor: '#f0fdf4' }}>
              <p className="text-sm" style={{ color: '#166534' }}>
                <span className="font-semibold">{searchResult.horse_name}</span>
                {searchResult.owner_name && <span> - owner: {searchResult.owner_name}</span>}
              </p>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={handleLink}
                  disabled={linking}
                  className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                  style={{ backgroundColor: '#166534', color: '#f0fdf4' }}
                >
                  {linking ? 'Adding...' : 'Add to my profile'}
                </button>
                <button
                  onClick={() => { setSearchResult(null); setSearchMessage(null); }}
                  className="px-3 py-1.5 rounded text-xs border"
                  style={{ borderColor: '#d4b896', color: '#8b7355' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {searchMessage && !searchResult && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs" style={{ color: '#8b4513' }}>{searchMessage}</p>
              {notFoundSearch && (
                <button
                  onClick={handleCreateFromSearch}
                  className="text-xs font-medium hover:underline shrink-0"
                  style={{ color: '#2c1810' }}
                >
                  Create new profile -&gt;
                </button>
              )}
            </div>
          )}

          <div>
            <button
              onClick={() => {
                setShowSearch(false);
                setSearchInput({ show_type_id: '', registration_number: '' });
                setSearchResult(null);
                setSearchMessage(null);
                setNotFoundSearch(false);
              }}
              className="text-xs hover:underline"
              style={{ color: '#8b7355' }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {!showSearch && !showForm && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <button
            onClick={() => setShowSearch(true)}
            className="text-left rounded-lg border p-4 transition-colors hover:border-amber-800/40 hover:bg-amber-50/50"
            style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
          >
            <p className="text-sm font-semibold mb-1" style={{ color: '#2c1810' }}>Find an existing horse</p>
            <p className="text-xs" style={{ color: '#8b7355' }}>Search by association registration number to add a horse already in the system.</p>
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="text-left rounded-lg border p-4 transition-colors hover:border-amber-800/40 hover:bg-amber-50/50"
            style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
          >
            <p className="text-sm font-semibold mb-1" style={{ color: '#2c1810' }}>Add a new horse</p>
            <p className="text-xs" style={{ color: '#8b7355' }}>Create a profile for a horse you own.</p>
          </button>
        </div>
      )}

      {showForm && (
        <div className="border rounded-lg p-4 space-y-4" style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}>
          <h3 className="text-sm font-semibold" style={{ color: '#2c1810' }}>Add a Horse</h3>

          {/* Owner selection */}
          <div className="space-y-2 pb-3 border-b" style={{ borderColor: '#e8d5b7' }}>
            <p className="text-xs font-medium" style={{ color: '#2c1810' }}>Who owns this horse? *</p>
            <div className="space-y-2">
              {/* Option 1 — I am the owner */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="ownerMode"
                  checked={owner.mode === 'self'}
                  onChange={() => handleOwnerMode('self')}
                  className="h-4 w-4"
                />
                <span className="text-sm" style={{ color: '#2c1810' }}>I own this horse</span>
              </label>

              {/* Option 2 — Existing owner in the system */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="ownerMode"
                  checked={owner.mode === 'existing'}
                  onChange={() => handleOwnerMode('existing')}
                  className="h-4 w-4"
                />
                <span className="text-sm" style={{ color: '#2c1810' }}>Owner is already in the system</span>
              </label>
              {owner.mode === 'existing' && (
                <div className="ml-6">
                  {loadingExhibitors ? (
                    <p className="text-xs" style={{ color: '#8b7355' }}>Loading…</p>
                  ) : (
                    <select
                      value={owner.exhibitorId}
                      onChange={(e) => setOwner((p) => ({ ...p, exhibitorId: e.target.value }))}
                      className="w-full border rounded px-3 py-2 text-sm"
                      style={{ borderColor: '#d4b896' }}
                    >
                      <option value="">Select owner…</option>
                      {exhibitorList.map((ex) => (
                        <option key={ex.id} value={ex.id}>{ex.full_name}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Option 3 — Enter owner details (new record) */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="ownerMode"
                  checked={owner.mode === 'new'}
                  onChange={() => handleOwnerMode('new')}
                  className="h-4 w-4"
                />
                <span className="text-sm" style={{ color: '#2c1810' }}>Enter owner information</span>
              </label>
              {owner.mode === 'new' && (
                <div className="ml-6 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    placeholder="First name *"
                    value={owner.firstName}
                    onChange={(e) => setOwner((p) => ({ ...p, firstName: e.target.value }))}
                    className="border rounded px-3 py-2 text-sm"
                    style={{ borderColor: '#d4b896' }}
                  />
                  <input
                    placeholder="Last name *"
                    value={owner.lastName}
                    onChange={(e) => setOwner((p) => ({ ...p, lastName: e.target.value }))}
                    className="border rounded px-3 py-2 text-sm"
                    style={{ borderColor: '#d4b896' }}
                  />
                  <input
                    type="email"
                    placeholder="Email *"
                    value={owner.email}
                    onChange={(e) => setOwner((p) => ({ ...p, email: e.target.value }))}
                    className="border rounded px-3 py-2 text-sm sm:col-span-2"
                    style={{ borderColor: '#d4b896' }}
                  />
                  <p className="text-xs sm:col-span-2" style={{ color: '#8b7355' }}>
                    If the owner has an account, their existing profile will be linked automatically.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Core fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              name="name"
              placeholder="Horse name *"
              value={form.name}
              onChange={handleChange}
              className="border rounded px-3 py-2 text-sm col-span-full"
            />
            <div>
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Trainer</label>
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
            <div className="col-span-full">
              <BreedCheckboxGroup
                breeds={breeds}
                selectedIds={form.breed_ids}
                onChange={(breed_ids) => setForm((prev) => ({ ...prev, breed_ids }))}
              />
            </div>
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
                    <option value="">Association...</option>
                    {availableShowTypes.map((st) => (
                      <option key={st.id} value={st.id}>{st.code} - {st.name}</option>
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
              {saving ? 'Saving...' : 'Save Horse'}
            </button>
            <button
              onClick={() => { setShowForm(false); setForm(emptyForm); setOwner(emptyOwner); setPendingRegs([]); setError(null); setRegError(null); setNewReg({ show_type_id: '', registration_number: '' }); }}
              className="px-4 py-2 rounded text-sm border"
              style={{ borderColor: '#d4b896', color: '#8b7355' }}
            >
              Cancel
            </button>
          </div>

        </div>
      )}
    </div>
  );
}

