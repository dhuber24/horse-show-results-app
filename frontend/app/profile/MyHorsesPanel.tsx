'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Association,
  HorseDocumentBrief,
  LookupMatch,
  MyHorse,
  SearchMatch,
  RegChips,
  SearchResultList,
} from './horse-shared';

export type { MyHorse } from './horse-shared';

interface Props {
  exhibitorId: string;
  initialHorses: MyHorse[];
}

type SearchMode = 'name' | 'registration';
type SortMode = 'name' | 'newest';

/** Documents inside this window are flagged as "expiring soon" on the horse card. */
const EXPIRY_WARNING_DAYS = 45;
/** Show the filter box only once the list is long enough for it to earn its space. */
const FILTER_THRESHOLD = 4;

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

type CogginsStatus = 'valid' | 'missing' | 'undated' | 'expired';

const COGGINS_BLOCKER_TEXT: Record<Exclude<CogginsStatus, 'valid'>, string> = {
  missing: 'No Coggins on file — blocks entry',
  undated: 'Coggins has no expiration date — blocks entry',
  expired: 'Coggins expired — blocks entry',
};

/**
 * Mirrors `coggins_status()` in `backend/routers/horse_documents.py`. Keep the
 * two in step: this is what tells the exhibitor whether a horse can be entered,
 * and the backend is what actually enforces it. A Coggins clears the horse only
 * when it carries an expiration date that has not passed, so an undated one is a
 * blocker rather than a pass — there is nothing on it to verify.
 */
function cogginsCheck(docs: HorseDocumentBrief[]): { status: CogginsStatus; daysLeft: number | null } {
  const coggins = docs.filter((d) => d.document_type === 'COGGINS');
  if (!coggins.length) return { status: 'missing', daysLeft: null };
  const dated = coggins.filter((d) => d.expiry_date).map((d) => daysUntil(d.expiry_date!));
  const furthest = dated.length ? Math.max(...dated) : null;
  if (furthest !== null && furthest >= 0) return { status: 'valid', daysLeft: furthest };
  // Report the undated case ahead of the expired one: it names the fixable data
  // problem, where "expired" sends the exhibitor after a test they may not need.
  if (coggins.some((d) => !d.expiry_date)) return { status: 'undated', daysLeft: null };
  return { status: 'expired', daysLeft: null };
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

  // Coggins is an entry gate, not just an expiry warning, so it gets the
  // backend's rule and a danger tone rather than the generic handling below.
  const coggins = cogginsCheck(docs);
  if (coggins.status !== 'valid') {
    flags.push({ tone: 'danger', text: COGGINS_BLOCKER_TEXT[coggins.status] });
  } else if (coggins.daysLeft !== null && coggins.daysLeft <= EXPIRY_WARNING_DAYS) {
    flags.push({
      tone: 'warn',
      text: `Coggins expires in ${coggins.daysLeft} day${coggins.daysLeft === 1 ? '' : 's'}`,
    });
  }

  // Only the most recent document of each type matters — an expired vaccination
  // record that has already been replaced by a current one is not a problem.
  const sortKey = (d: HorseDocumentBrief) => d.expiry_date ?? d.issue_date ?? '';
  const latestByType = new Map<string, HorseDocumentBrief>();
  for (const doc of docs) {
    if (doc.document_type === 'COGGINS') continue;
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

export default function MyHorsesPanel({ exhibitorId, initialHorses }: Props) {
  const router = useRouter();
  const [horses, setHorses] = useState<MyHorse[]>(initialHorses);

  // Only needed for the registration-number search below; the add-a-horse wizard
  // now lives on its own page and loads its own lookups.
  const [associations, setAssociations] = useState<Association[]>([]);

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
    fetch('/api/associations').then((r) => r.json()).then(setAssociations).catch(() => {});
  }, []);

  const visibleHorses = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const matched = term
      ? horses.filter((h) => {
          const haystack = [
            h.name,
            h.barn_name,
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

  const addHorseToList = (horse: MyHorse) => {
    setHorses((prev) => [...prev, horse]);
    resetSearchPanel();
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

  /** Fall back to creating a new horse, carrying over whatever the search already
   *  knew as query params for the wizard page to seed itself from. */
  const handleCreateFromSearch = () => {
    const params = new URLSearchParams();
    if (searchMode === 'name' && nameQuery.trim()) params.set('name', nameQuery.trim());
    if (searchInput.association_id && searchInput.registration_number.trim()) {
      params.set('association_id', searchInput.association_id);
      params.set('registration_number', searchInput.registration_number.trim());
    }
    const qs = params.toString();
    router.push(`/profile/horses/new${qs ? `?${qs}` : ''}`);
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
      addHorseToList(await res.json());
    } else {
      const err = await res.json().catch(() => ({}));
      setSearchMessage(err.detail ?? 'Failed to add horse to your profile.');
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

  const panelOpen = showSearch;
  const profileHorseIds = new Set(horses.map((h) => h.id));

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
            <Link
              href="/profile/horses/new"
              className="px-3 py-1.5 rounded text-sm font-medium"
              style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
            >
              Add a horse
            </Link>
          </div>
        )}
      </div>

      {/* The `|| filter` keeps the box mounted while a filter is active: removing
          horses can drop the list under the threshold, and hiding the input then
          would strand the list filtered with no way to clear it. */}
      {(horses.length >= FILTER_THRESHOLD || filter) && (
        <div className="flex flex-wrap gap-2 items-center">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name, barn name, sire, dam, or registration #"
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
        <p className="text-sm flex flex-wrap items-center gap-2" style={{ color: '#8b7355' }}>
          <span>No horses match &ldquo;{filter}&rdquo;.</span>
          <button onClick={() => setFilter('')} className="text-xs font-medium hover:underline" style={{ color: '#8b4513' }}>
            Clear filter
          </button>
        </p>
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
                    {horse.barn_name && (
                      <span className="font-normal" style={{ color: '#8b7355' }}>&ldquo;{horse.barn_name}&rdquo;</span>
                    )}
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
                        href={`/profile/horses/${horse.id}?section=health`}
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
                  {associations.map((st) => (
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

    </div>
  );
}
