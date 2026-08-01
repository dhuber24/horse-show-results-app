'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import BreedCheckboxGroup from '@/components/BreedCheckboxGroup';
import TrainerSelect from '@/components/TrainerSelect';

interface Breed { id: string; name: string; }
interface HorseColor { id: string; name: string; }
export type AssociationType = 'breed' | 'club';
interface Association { id: string; code: string; name: string; association_type: AssociationType; }
interface PendingReg { association_id: string; association_code: string; association_name: string; association_type: AssociationType; registration_number: string; }
export interface HorseRegistrationBrief { association_id: string; association_code: string; association_type: AssociationType; registration_number: string; }
export interface HorseDocumentBrief {
  document_type: string;
  document_type_label: string;
  issue_date: string | null;
  expiry_date: string | null;
}
export interface MyHorse {
  id: string;
  name: string;
  sex: string | null;
  age: number | null;
  breed_name: string | null;
  breed_names?: string[];
  color_name: string | null;
  is_solid_paint_bred: boolean;
  owner_exhibitor_id: string | null;
  owner_exhibitor_name?: string | null;
  owner_name?: string | null;
  trainer_name?: string | null;
  sire_name?: string | null;
  dam_name?: string | null;
  created_by_exhibitor_id: string | null;
  created_at?: string;
  registrations?: HorseRegistrationBrief[];
  documents?: HorseDocumentBrief[];
}

interface LookupMatch {
  horse_id: string;
  horse_name: string;
  owner_name: string | null;
}

interface SearchMatch {
  horse_id: string;
  horse_name: string;
  owner_name: string | null;
  sex: string | null;
  breed_name: string | null;
  registrations: HorseRegistrationBrief[];
}

interface Props {
  exhibitorId: string;
  initialHorses: MyHorse[];
}

/**
 * 'self'  — the exhibitor owns the horse and fills in its details directly.
 * 'ride'  — the exhibitor rides someone else's horse: they search for it first,
 *           and only enter owner + horse details if it isn't in the app yet.
 */
type OwnerMode = 'self' | 'ride';
type SearchMode = 'name' | 'registration';
type SortMode = 'name' | 'newest';

/** Documents inside this window are flagged as "expiring soon" on the horse card. */
const EXPIRY_WARNING_DAYS = 45;
/** Show the filter box only once the list is long enough for it to earn its space. */
const FILTER_THRESHOLD = 4;

const emptyForm = { name: '', trainer_id: '', trainer_name: '', trainer_first_name: '', trainer_last_name: '', trainer_email: '', sex: '', sire_name: '', dam_name: '', foaling_date: '', breed_ids: [] as string[], color_id: '', is_solid_paint_bred: false };
const emptyOwner = { mode: 'self' as OwnerMode, firstName: '', lastName: '', email: '' };

type FlagTone = 'danger' | 'warn';
interface ReadinessFlag { tone: FlagTone; text: string; }

const FLAG_STYLES: Record<FlagTone, { backgroundColor: string; color: string }> = {
  danger: { backgroundColor: '#fee2e2', color: '#991b1b' },
  warn: { backgroundColor: '#fef3c7', color: '#92400e' },
};

function daysUntil(isoDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${isoDate}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

/**
 * What would stop this horse from being entered at a show — missing paperwork
 * and expiring documents. Document status is only returned by the API for horses
 * the caller owns, so non-owned horses only get the registration check.
 */
function readinessFlags(horse: MyHorse, isOwner: boolean): ReadinessFlag[] {
  const flags: ReadinessFlag[] = [];
  if (!horse.registrations?.length) {
    flags.push({ tone: 'warn', text: 'No association registration on file' });
  }
  if (!isOwner) return flags;

  const docs = horse.documents ?? [];
  if (!docs.some((d) => d.document_type === 'COGGINS')) {
    flags.push({ tone: 'warn', text: 'No Coggins on file' });
  }

  // Only the most recent document of each type matters — an expired Coggins that
  // has already been replaced by a current one is not a problem.
  const sortKey = (d: HorseDocumentBrief) => d.expiry_date ?? d.issue_date ?? '';
  const latestByType = new Map<string, HorseDocumentBrief>();
  for (const doc of docs) {
    const current = latestByType.get(doc.document_type);
    if (!current || sortKey(doc) > sortKey(current)) latestByType.set(doc.document_type, doc);
  }

  for (const doc of latestByType.values()) {
    if (!doc.expiry_date) continue;
    const days = daysUntil(doc.expiry_date);
    if (days < 0) {
      flags.push({ tone: 'danger', text: `${doc.document_type_label} expired` });
    } else if (days <= EXPIRY_WARNING_DAYS) {
      flags.push({
        tone: 'warn',
        text: `${doc.document_type_label} expires in ${days} day${days === 1 ? '' : 's'}`,
      });
    }
  }
  return flags;
}

/** Breed registries and club memberships are different things, so they read
 *  differently: breed numbers are the horse's identity, club numbers are opt-in. */
const REG_CHIP_STYLES: Record<AssociationType, { backgroundColor: string; color: string }> = {
  breed: { backgroundColor: '#f0e8d8', color: '#8b4513' },
  club: { backgroundColor: '#e0e7ff', color: '#3730a3' },
};

function RegChips({ registrations }: { registrations: HorseRegistrationBrief[] }) {
  if (!registrations.length) return null;
  // Breed first — it's the horse's primary identity at a show.
  const ordered = [...registrations].sort((a, b) =>
    a.association_type === b.association_type ? 0 : a.association_type === 'breed' ? -1 : 1
  );
  return (
    <div className="flex flex-wrap gap-1.5">
      {ordered.map((r) => (
        <span
          key={r.association_id}
          className="text-xs px-1.5 py-0.5 rounded"
          style={REG_CHIP_STYLES[r.association_type] ?? REG_CHIP_STYLES.breed}
          title={r.association_type === 'club' ? 'Club membership' : 'Breed registration'}
        >
          <span className="font-mono font-semibold">{r.association_code}</span>{' '}
          <span className="font-mono">{r.registration_number}</span>
        </span>
      ))}
    </div>
  );
}

/** Shared by the standalone "find a horse" panel and the add-form's ride-only search. */
function SearchResultList({
  results,
  existingIds,
  onSelect,
  busyId,
  actionLabel,
}: {
  results: SearchMatch[];
  existingIds: Set<string>;
  onSelect: (horseId: string) => void;
  busyId: string | null;
  actionLabel: string;
}) {
  return (
    <ul className="divide-y rounded border" style={{ borderColor: '#e8d5b7', backgroundColor: '#ffffff' }}>
      {results.map((match) => {
        const alreadyOnProfile = existingIds.has(match.horse_id);
        const detail = [match.sex, match.breed_name, match.owner_name && `owner: ${match.owner_name}`]
          .filter(Boolean) as string[];
        return (
          <li key={match.horse_id} className="flex flex-wrap items-center justify-between gap-2 p-3" style={{ borderColor: '#f0e4d0' }}>
            <div className="min-w-0">
              <p className="text-sm font-medium" style={{ color: '#2c1810' }}>{match.horse_name}</p>
              {detail.length > 0 && (
                <p className="text-xs" style={{ color: '#8b7355' }}>{detail.join(' · ')}</p>
              )}
              <div className="mt-1"><RegChips registrations={match.registrations} /></div>
            </div>
            {alreadyOnProfile ? (
              <span className="text-xs shrink-0" style={{ color: '#8b7355' }}>Already on your profile</span>
            ) : (
              <button
                onClick={() => onSelect(match.horse_id)}
                disabled={busyId !== null}
                className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50 shrink-0"
                style={{ backgroundColor: '#166534', color: '#f0fdf4' }}
              >
                {busyId === match.horse_id ? 'Adding...' : actionLabel}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function MyHorsesPanel({ exhibitorId, initialHorses }: Props) {
  const [horses, setHorses] = useState<MyHorse[]>(initialHorses);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [breeds, setBreeds] = useState<Breed[]>([]);
  const [colors, setColors] = useState<HorseColor[]>([]);
  const [associations, setAssociations] = useState<Association[]>([]);

  const [owner, setOwner] = useState(emptyOwner);

  // Ride-mode search inside the add form: the exhibitor must look for the horse
  // before they are allowed to type owner + horse details by hand.
  const [rideQuery, setRideQuery] = useState('');
  const [rideResults, setRideResults] = useState<SearchMatch[] | null>(null);
  const [rideSearching, setRideSearching] = useState(false);
  const [rideMessage, setRideMessage] = useState<string | null>(null);
  const [manualEntry, setManualEntry] = useState(false);

  const [pendingRegs, setPendingRegs] = useState<PendingReg[]>([]);
  const emptyNewReg = { association_id: '', association_type: null as AssociationType | null, registration_number: '' };
  const [newReg, setNewReg] = useState(emptyNewReg);
  const [regError, setRegError] = useState<string | null>(null);

  // List controls
  const [filter, setFilter] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('name');

  // "Find existing horse" search panel state
  const [showSearch, setShowSearch] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>('name');
  const [nameQuery, setNameQuery] = useState('');
  const [nameResults, setNameResults] = useState<SearchMatch[] | null>(null);
  const [searchInput, setSearchInput] = useState({ association_id: '', registration_number: '' });
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<LookupMatch | null>(null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [notFoundSearch, setNotFoundSearch] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [confirmUnlinkId, setConfirmUnlinkId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/breeds').then((r) => r.json()).then(setBreeds).catch(() => {});
    fetch('/api/horse-colors').then((r) => r.json()).then(setColors).catch(() => {});
    fetch('/api/associations').then((r) => r.json()).then(setAssociations).catch(() => {});
  }, []);

  const visibleHorses = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const matched = term
      ? horses.filter((h) => {
          const haystack = [
            h.name,
            h.sire_name,
            h.dam_name,
            h.breed_names?.join(' ') ?? h.breed_name,
            h.color_name,
            h.trainer_name,
            ...(h.registrations ?? []).flatMap((r) => [r.association_code, r.registration_number]),
          ];
          return haystack.some((v) => v?.toLowerCase().includes(term));
        })
      : horses;
    return [...matched].sort((a, b) =>
      sortMode === 'newest'
        ? (b.created_at ?? '').localeCompare(a.created_at ?? '')
        : a.name.localeCompare(b.name)
    );
  }, [horses, filter, sortMode]);

  const resetSearchPanel = () => {
    setShowSearch(false);
    setNameQuery('');
    setNameResults(null);
    setSearchInput({ association_id: '', registration_number: '' });
    setSearchResult(null);
    setSearchMessage(null);
    setNotFoundSearch(false);
  };

  const resetAddForm = () => {
    setShowForm(false);
    setForm(emptyForm);
    setOwner(emptyOwner);
    setPendingRegs([]);
    setError(null);
    setRegError(null);
    setNewReg(emptyNewReg);
    setRideQuery('');
    setRideResults(null);
    setRideMessage(null);
    setManualEntry(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleOwnerMode = (mode: OwnerMode) => {
    setOwner((prev) => ({ ...prev, mode }));
    setError(null);
    // Switching modes restarts the ride-mode search so a stale result set can't
    // leak into the other branch.
    setRideQuery('');
    setRideResults(null);
    setRideMessage(null);
    setManualEntry(false);
  };

  const handleRideSearch = async () => {
    const term = rideQuery.trim();
    if (term.length < 2) {
      setRideMessage('Enter at least 2 characters to search.');
      setRideResults(null);
      return;
    }
    setRideSearching(true);
    setRideMessage(null);
    const res = await fetch(`/api/horses/search?q=${encodeURIComponent(term)}`);
    setRideSearching(false);
    if (!res.ok) {
      setRideResults(null);
      setRideMessage('Search failed. Try again.');
      return;
    }
    const matches: SearchMatch[] = await res.json();
    setRideResults(matches);
    setRideMessage(matches.length === 0 ? `No horse found matching "${term}".` : null);
  };

  const handleAddReg = async () => {
    if (!newReg.association_id || !newReg.registration_number.trim()) {
      setRegError('Select an association and enter a registration number.');
      return;
    }
    const trimmed = newReg.registration_number.trim();
    const st = associations.find((s) => s.id === newReg.association_id)!;

    // Check if this registration number is already on file for another horse
    const qs = new URLSearchParams({ association_id: newReg.association_id, registration_number: trimmed });
    const lookupRes = await fetch(`/api/horses/registrations/lookup?${qs.toString()}`);
    if (lookupRes.ok) {
      const existing = await lookupRes.json();
      const ownerLabel = existing.owner_name ? ` (owner: ${existing.owner_name})` : '';
      setRegError(
        `${st.code} #${trimmed} is already on file for horse "${existing.horse_name}"${ownerLabel}. ` +
        `If this is the same horse, contact your show secretary.`
      );
      return;
    }

    setPendingRegs((prev) => [...prev, {
      association_id: newReg.association_id,
      association_code: st.code,
      association_name: st.name,
      association_type: st.association_type,
      registration_number: trimmed,
    }]);
    setNewReg(emptyNewReg);
    setRegError(null);
  };

  const handleRemoveReg = (association_id: string) => {
    setPendingRegs((prev) => prev.filter((r) => r.association_id !== association_id));
  };

  const handleAdd = async () => {
    if (!form.name.trim()) { setError('Horse name is required.'); return; }
    if (owner.mode === 'ride') {
      if (!owner.firstName.trim() || !owner.lastName.trim() || !owner.email.trim()) {
        setError("Owner first name, last name, and email are all required for a horse you don't own.");
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
      // The backend links to an existing exhibitor when the email matches one,
      // and otherwise creates a standalone owner record.
      ...(owner.mode === 'ride' && {
        owner_first_name: owner.firstName.trim(),
        owner_last_name: owner.lastName.trim(),
        owner_email: owner.email.trim(),
      }),
      registrations: pendingRegs.map((r) => ({
        association_id: r.association_id,
        registration_number: r.registration_number,
      })),
    };
    body.trainer_id = form.trainer_id || null;
    body.trainer_name = form.trainer_name.trim() || null;
    body.trainer_first_name = form.trainer_first_name.trim() || null;
    body.trainer_last_name = form.trainer_last_name.trim() || null;
    body.trainer_email = form.trainer_email.trim() || null;
    if (form.sex) body.sex = form.sex;
    if (form.sire_name.trim()) body.sire_name = form.sire_name.trim();
    if (form.dam_name.trim()) body.dam_name = form.dam_name.trim();
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

    const created: MyHorse = await res.json();
    setHorses((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    resetAddForm();
  };

  const handleNameSearch = async () => {
    const term = nameQuery.trim();
    if (term.length < 2) {
      setSearchMessage('Enter at least 2 characters to search.');
      setNameResults(null);
      return;
    }
    setSearching(true);
    setSearchMessage(null);
    const res = await fetch(`/api/horses/search?q=${encodeURIComponent(term)}`);
    setSearching(false);
    if (!res.ok) {
      setNameResults(null);
      setSearchMessage('Search failed. Try again.');
      return;
    }
    const matches: SearchMatch[] = await res.json();
    setNameResults(matches);
    if (matches.length === 0) setSearchMessage(`No horse found matching "${term}".`);
  };

  const handleRegSearch = async () => {
    if (!searchInput.association_id || !searchInput.registration_number.trim()) {
      setSearchMessage('Select an association and enter a registration number.');
      setSearchResult(null);
      return;
    }
    setSearching(true);
    setSearchMessage(null);
    setSearchResult(null);
    const qs = new URLSearchParams({
      association_id: searchInput.association_id,
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

  /** Fall back to creating a new horse, carrying over whatever the search already knew. */
  const handleCreateFromSearch = () => {
    const st = associations.find((s) => s.id === searchInput.association_id);
    if (st && searchInput.registration_number.trim()) {
      setPendingRegs([{
        association_id: st.id,
        association_code: st.code,
        association_name: st.name,
        association_type: st.association_type,
        registration_number: searchInput.registration_number.trim(),
      }]);
    }
    const carriedName = searchMode === 'name' ? nameQuery.trim() : '';
    resetSearchPanel();
    if (carriedName) setForm((prev) => ({ ...prev, name: carriedName }));
    setShowForm(true);
  };

  const handleLink = async (horseId: string) => {
    setLinkingId(horseId);
    const res = await fetch(`/api/exhibitors/${exhibitorId}/linked-horses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ horse_id: horseId }),
    });
    setLinkingId(null);
    if (res.ok) {
      const linked: MyHorse = await res.json();
      setHorses((prev) => [...prev, linked].sort((a, b) => a.name.localeCompare(b.name)));
      // The horse is on the profile now, so close whichever surface started this.
      resetSearchPanel();
      resetAddForm();
    } else {
      const err = await res.json().catch(() => ({}));
      const detail = err.detail ?? 'Failed to add horse to your profile.';
      setSearchMessage(detail);
      setRideMessage(detail);
    }
  };

  const handleRemoveFromProfile = async (horse: MyHorse) => {
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

  const usedAssociationIds = new Set(pendingRegs.map((r) => r.association_id));
  const availableAssociations = associations.filter((a) => !usedAssociationIds.has(a.id));
  const searchableAssociations = associations;
  const panelOpen = showForm || showSearch;
  const profileHorseIds = new Set(horses.map((h) => h.id));
  // In ride mode the horse-detail fields stay hidden until the search comes up empty —
  // searching first is what stops duplicate horse records from piling up.
  const showHorseFields = owner.mode === 'self' || manualEntry;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm" style={{ color: '#8b7355' }}>
          {horses.length === 0
            ? 'No horses yet'
            : `${horses.length} horse${horses.length === 1 ? '' : 's'} on your profile`}
        </p>
        {!panelOpen && (
          <div className="flex gap-2">
            <button
              onClick={() => { setShowSearch(true); setSearchMode('name'); }}
              className="px-3 py-1.5 rounded text-sm font-medium border"
              style={{ borderColor: '#d4b896', color: '#5c3d1e', backgroundColor: '#ffffff' }}
            >
              Find existing horse
            </button>
            <button
              onClick={() => setShowForm(true)}
              className="px-3 py-1.5 rounded text-sm font-medium"
              style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
            >
              Add a horse
            </button>
          </div>
        )}
      </div>

      {horses.length >= FILTER_THRESHOLD && (
        <div className="flex flex-wrap gap-2 items-center">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name, sire, dam, or registration #"
            className="flex-1 min-w-[200px] border rounded px-3 py-2 text-sm"
            style={{ borderColor: '#d4b896' }}
          />
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="border rounded px-3 py-2 text-sm"
            style={{ borderColor: '#d4b896' }}
            aria-label="Sort horses"
          >
            <option value="name">Name A-Z</option>
            <option value="newest">Recently added</option>
          </select>
        </div>
      )}

      {/* Horse list */}
      {horses.length === 0 ? (
        // With a panel open the empty-state copy is just noise — the panel says it better.
        !panelOpen && (
          <div className="rounded-lg border border-dashed p-6 text-center" style={{ borderColor: '#d4b896' }}>
            <p className="text-sm font-medium" style={{ color: '#2c1810' }}>No horses on your profile yet</p>
            <p className="text-xs mt-1" style={{ color: '#8b7355' }}>
              Add the horses you show so you can pick them when you register for a show.
              If a horse is already in the system, find it by name or registration number instead of creating a duplicate.
            </p>
          </div>
        )
      ) : visibleHorses.length === 0 ? (
        <p className="text-sm" style={{ color: '#8b7355' }}>No horses match &ldquo;{filter}&rdquo;.</p>
      ) : (
        <ul className="space-y-3">
          {visibleHorses.map((horse) => {
            const isOwner = horse.owner_exhibitor_id === exhibitorId;
            const isCreator = horse.created_by_exhibitor_id === exhibitorId;
            const badgeLabel = isOwner ? 'Owner' : isCreator ? 'Created' : 'Linked';
            const badgeStyle = isOwner
              ? { backgroundColor: '#fef3c7', color: '#92400e' }
              : isCreator
                ? { backgroundColor: '#dcfce7', color: '#166534' }
                : { backgroundColor: '#e0e7ff', color: '#3730a3' };
            const breedLabel = horse.breed_names?.length ? horse.breed_names.join(', ') : horse.breed_name;
            const spec = [breedLabel, horse.color_name, horse.age !== null && horse.age !== undefined ? `${horse.age} yr` : null]
              .filter(Boolean) as string[];
            const ownerLabel = isOwner ? null : (horse.owner_exhibitor_name || horse.owner_name);
            const flags = readinessFlags(horse, isOwner);

            return (
              <li
                key={horse.id}
                className="rounded-lg border p-4"
                style={{ borderColor: '#e8d5b7', backgroundColor: '#fdfbf7' }}
              >
                <div className="space-y-1.5">
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

                  {spec.length > 0 && (
                    <p className="text-xs" style={{ color: '#8b7355' }}>{spec.join(' · ')}</p>
                  )}

                  {(horse.sire_name || horse.dam_name) && (
                    <p className="text-xs" style={{ color: '#8b7355' }}>
                      {horse.sire_name && <>Sire: <span style={{ color: '#5c3d1e' }}>{horse.sire_name}</span></>}
                      {horse.sire_name && horse.dam_name && ' · '}
                      {horse.dam_name && <>Dam: <span style={{ color: '#5c3d1e' }}>{horse.dam_name}</span></>}
                    </p>
                  )}

                  {(ownerLabel || horse.trainer_name) && (
                    <p className="text-xs" style={{ color: '#8b7355' }}>
                      {ownerLabel && <>Owner: <span style={{ color: '#5c3d1e' }}>{ownerLabel}</span></>}
                      {ownerLabel && horse.trainer_name && ' · '}
                      {horse.trainer_name && <>Trainer: <span style={{ color: '#5c3d1e' }}>{horse.trainer_name}</span></>}
                    </p>
                  )}

                  <RegChips registrations={horse.registrations ?? []} />

                  {flags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {flags.map((flag) => (
                        <span
                          key={flag.text}
                          className="text-xs px-1.5 py-0.5 rounded font-medium"
                          style={FLAG_STYLES[flag.tone]}
                        >
                          {flag.text}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Actions live in their own row so cards stay aligned no matter
                    how many readiness flags a horse has. */}
                <div
                  className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t"
                  style={{ borderColor: '#f0e4d0' }}
                >
                  {isOwner ? (
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
                  ) : (
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
                      Remove
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
            If a horse is already in the system, add it to your profile instead of creating a second record for it.
          </p>

          <div className="flex gap-2">
            {(['name', 'registration'] as SearchMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => {
                  setSearchMode(mode);
                  setSearchMessage(null);
                  setSearchResult(null);
                  setNameResults(null);
                  setNotFoundSearch(false);
                }}
                className="px-3 py-1.5 rounded text-xs font-medium border"
                style={
                  searchMode === mode
                    ? { backgroundColor: '#2c1810', color: '#f5ede0', borderColor: '#2c1810' }
                    : { backgroundColor: '#ffffff', color: '#8b7355', borderColor: '#d4b896' }
                }
              >
                {mode === 'name' ? 'By horse name' : 'By registration #'}
              </button>
            ))}
          </div>

          {searchMode === 'name' ? (
            <div className="flex flex-wrap gap-2 items-end">
              <div className="flex-1 min-w-[180px]">
                <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Horse name or registration #</label>
                <input
                  value={nameQuery}
                  onChange={(e) => setNameQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleNameSearch(); }}
                  placeholder="e.g. Fancy Little Gun"
                  className="w-full border rounded px-3 py-2 text-sm"
                  style={{ borderColor: '#d4b896' }}
                />
              </div>
              <button
                onClick={handleNameSearch}
                disabled={searching}
                className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
              >
                {searching ? 'Searching...' : 'Search'}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 items-end">
              <div className="flex-1 min-w-[140px]">
                <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Association</label>
                <select
                  value={searchInput.association_id}
                  onChange={(e) => setSearchInput((p) => ({ ...p, association_id: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm"
                  style={{ borderColor: '#d4b896' }}
                >
                  <option value="">Select...</option>
                  {searchableAssociations.map((st) => (
                    <option key={st.id} value={st.id}>{st.code} - {st.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1 min-w-[140px]">
                <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Registration #</label>
                <input
                  value={searchInput.registration_number}
                  onChange={(e) => setSearchInput((p) => ({ ...p, registration_number: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleRegSearch(); }}
                  placeholder="e.g. 1234567"
                  className="w-full border rounded px-3 py-2 text-sm"
                  style={{ borderColor: '#d4b896' }}
                />
              </div>
              <button
                onClick={handleRegSearch}
                disabled={searching}
                className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
              >
                {searching ? 'Searching...' : 'Search'}
              </button>
            </div>
          )}

          {/* Name-search results */}
          {searchMode === 'name' && nameResults && nameResults.length > 0 && (
            <SearchResultList
              results={nameResults}
              existingIds={profileHorseIds}
              onSelect={handleLink}
              busyId={linkingId}
              actionLabel="Add to my profile"
            />
          )}

          {/* Registration-search result */}
          {searchMode === 'registration' && searchResult && (
            <div className="rounded p-3 border" style={{ borderColor: '#86efac', backgroundColor: '#f0fdf4' }}>
              <p className="text-sm" style={{ color: '#166534' }}>
                <span className="font-semibold">{searchResult.horse_name}</span>
                {searchResult.owner_name && <span> - owner: {searchResult.owner_name}</span>}
              </p>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => handleLink(searchResult.horse_id)}
                  disabled={linkingId !== null}
                  className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                  style={{ backgroundColor: '#166534', color: '#f0fdf4' }}
                >
                  {linkingId ? 'Adding...' : 'Add to my profile'}
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
              {(notFoundSearch || (searchMode === 'name' && nameResults?.length === 0)) && (
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
            <button onClick={resetSearchPanel} className="text-xs hover:underline" style={{ color: '#8b7355' }}>
              Close
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <div className="border rounded-lg p-4 space-y-4" style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}>
          <h3 className="text-sm font-semibold" style={{ color: '#2c1810' }}>Add a Horse</h3>

          {/* Owner selection */}
          <div className="space-y-2 pb-3 border-b" style={{ borderColor: '#e8d5b7' }}>
            <p className="text-xs font-medium" style={{ color: '#2c1810' }}>Is this your horse? *</p>
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

              {/* Option 2 — Rider on someone else's horse */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="ownerMode"
                  checked={owner.mode === 'ride'}
                  onChange={() => handleOwnerMode('ride')}
                  className="h-4 w-4"
                />
                <span className="text-sm" style={{ color: '#2c1810' }}>I ride this horse, but do not own it</span>
              </label>
            </div>
          </div>

          {/* Ride mode: search the app for the horse before entering anything by hand */}
          {owner.mode === 'ride' && !manualEntry && (
            <div className="space-y-3 pb-3 border-b" style={{ borderColor: '#e8d5b7' }}>
              <p className="text-xs" style={{ color: '#8b7355' }}>
                Search for the horse and its owner first — if they&rsquo;re already in the app, adding them
                here keeps everyone on the same record.
              </p>
              <div className="flex flex-wrap gap-2 items-end">
                <div className="flex-1 min-w-[180px]">
                  <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Horse name or registration #</label>
                  <input
                    value={rideQuery}
                    onChange={(e) => setRideQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRideSearch(); }}
                    placeholder="e.g. Fancy Little Gun"
                    className="w-full border rounded px-3 py-2 text-sm"
                    style={{ borderColor: '#d4b896' }}
                  />
                </div>
                <button
                  onClick={handleRideSearch}
                  disabled={rideSearching}
                  className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
                  style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
                >
                  {rideSearching ? 'Searching...' : 'Search'}
                </button>
              </div>

              {rideResults && rideResults.length > 0 && (
                <SearchResultList
                  results={rideResults}
                  existingIds={profileHorseIds}
                  onSelect={handleLink}
                  busyId={linkingId}
                  actionLabel="Select this horse"
                />
              )}

              {rideMessage && <p className="text-xs" style={{ color: '#8b4513' }}>{rideMessage}</p>}

              {rideResults && (
                <button
                  onClick={() => {
                    setManualEntry(true);
                    // Carry the search term over as the horse name when it isn't a reg number.
                    if (!form.name.trim() && /[a-z]/i.test(rideQuery)) {
                      setForm((prev) => ({ ...prev, name: rideQuery.trim() }));
                    }
                  }}
                  className="text-xs font-medium hover:underline"
                  style={{ color: '#2c1810' }}
                >
                  Not in the app? Enter the owner and horse details -&gt;
                </button>
              )}
            </div>
          )}

          {/* Ride mode, horse not found: owner details are required */}
          {owner.mode === 'ride' && manualEntry && (
            <div className="space-y-2 pb-3 border-b" style={{ borderColor: '#e8d5b7' }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium" style={{ color: '#2c1810' }}>Horse Owner *</p>
                <button
                  onClick={() => { setManualEntry(false); setError(null); }}
                  className="text-xs hover:underline"
                  style={{ color: '#8b7355' }}
                >
                  &lt;- Back to search
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  placeholder="Owner first name *"
                  value={owner.firstName}
                  onChange={(e) => setOwner((p) => ({ ...p, firstName: e.target.value }))}
                  className="border rounded px-3 py-2 text-sm"
                  style={{ borderColor: '#d4b896' }}
                />
                <input
                  placeholder="Owner last name *"
                  value={owner.lastName}
                  onChange={(e) => setOwner((p) => ({ ...p, lastName: e.target.value }))}
                  className="border rounded px-3 py-2 text-sm"
                  style={{ borderColor: '#d4b896' }}
                />
                <input
                  type="email"
                  placeholder="Owner email *"
                  value={owner.email}
                  onChange={(e) => setOwner((p) => ({ ...p, email: e.target.value }))}
                  className="border rounded px-3 py-2 text-sm sm:col-span-2"
                  style={{ borderColor: '#d4b896' }}
                />
                <p className="text-xs sm:col-span-2" style={{ color: '#8b7355' }}>
                  If the owner already has an account, their existing profile will be linked automatically.
                </p>
              </div>
            </div>
          )}

          {/* Core fields */}
          {showHorseFields && (
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
            <div>
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Sire</label>
              <input
                name="sire_name"
                value={form.sire_name}
                onChange={handleChange}
                maxLength={200}
                placeholder="Registered name"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Dam</label>
              <input
                name="dam_name"
                value={form.dam_name}
                onChange={handleChange}
                maxLength={200}
                placeholder="Registered name"
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
          )}

          {/* Association numbers, split by kind: breed registries identify the
              horse; club memberships are separate opt-in bodies. */}
          {showHorseFields && (
          <div className="space-y-3 pt-1 border-t" style={{ borderColor: '#e8d5b7' }}>
            {(['breed', 'club'] as AssociationType[]).map((kind) => {
              const queued = pendingRegs.filter((r) => r.association_type === kind);
              const options = availableAssociations.filter((a) => a.association_type === kind);
              if (!queued.length && !options.length) return null;
              return (
                <div key={kind} className="space-y-2">
                  <p className="text-xs font-medium pt-2" style={{ color: '#2c1810' }}>
                    {kind === 'breed' ? 'Breed Registrations' : 'Club Memberships'}
                  </p>
                  <p className="text-xs" style={{ color: '#8b7355' }}>
                    {kind === 'breed'
                      ? 'Registry numbers issued for this horse (AQHA, APHA, ...).'
                      : 'Club membership numbers carried by this horse (NSBA, WSCA, ...).'}
                  </p>

                  {queued.length > 0 && (
                    <ul className="space-y-1">
                      {queued.map((r) => (
                        <li
                          key={r.association_id}
                          className="flex items-center justify-between p-2 rounded text-sm"
                          style={REG_CHIP_STYLES[kind]}
                        >
                          <span>
                            <span className="font-mono font-semibold mr-2">{r.association_code}</span>
                            {r.registration_number}
                          </span>
                          <button onClick={() => handleRemoveReg(r.association_id)} className="text-xs text-red-600 hover:text-red-800 ml-3">
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {options.length > 0 && (
                    <div className="flex flex-wrap gap-2 items-end">
                      <div className="flex-1 min-w-[140px]">
                        <select
                          value={newReg.association_type === kind ? newReg.association_id : ''}
                          onChange={(e) => setNewReg({
                            association_id: e.target.value,
                            association_type: kind,
                            registration_number: newReg.association_type === kind ? newReg.registration_number : '',
                          })}
                          className="w-full border rounded px-3 py-2 text-sm"
                        >
                          <option value="">{kind === 'breed' ? 'Breed registry...' : 'Club...'}</option>
                          {options.map((a) => (
                            <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex-1 min-w-[120px]">
                        <input
                          value={newReg.association_type === kind ? newReg.registration_number : ''}
                          onChange={(e) => setNewReg((p) => ({ ...p, association_type: kind, registration_number: e.target.value }))}
                          placeholder={kind === 'breed' ? 'Reg #' : 'Member #'}
                          className="w-full border rounded px-3 py-2 text-sm"
                        />
                      </div>
                      <button
                        onClick={handleAddReg}
                        disabled={newReg.association_type !== kind}
                        title={newReg.association_type !== kind ? 'Pick an association and enter a number first' : undefined}
                        className="px-3 py-2 rounded text-sm font-medium disabled:opacity-50"
                        style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
                      >
                        Add
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {regError && <p className="text-red-600 text-xs">{regError}</p>}
          </div>
          )}

          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex gap-2">
            {showHorseFields && (
              <button
                onClick={handleAdd}
                disabled={saving}
                className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
              >
                {saving ? 'Saving...' : 'Save Horse'}
              </button>
            )}
            <button
              onClick={resetAddForm}
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
