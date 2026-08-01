'use client';

import { useState, useEffect } from 'react';
import BreedCheckboxGroup from '@/components/BreedCheckboxGroup';
import TrainerSelect from '@/components/TrainerSelect';
import {
  Association,
  AssociationType,
  Breed,
  HorseColor,
  MyHorse,
  PendingReg,
  SearchMatch,
  REG_CHIP_STYLES,
  SearchResultList,
} from './horse-shared';

/**
 * 'self'  — the exhibitor owns the horse and fills in its details directly.
 * 'ride'  — the exhibitor rides someone else's horse: they search for it first,
 *           and only enter owner + horse details if it isn't in the app yet.
 */
type OwnerMode = 'self' | 'ride';

type StepKey = 'owner' | 'horse' | 'trainer' | 'registrations' | 'review';

/** Only Owner and Horse gate creation; everything else can be skipped and
 *  filled in later from the horse's own page. */
const STEPS: { key: StepKey; label: string; optional?: boolean }[] = [
  { key: 'owner', label: 'Owner' },
  { key: 'horse', label: 'Horse' },
  { key: 'trainer', label: 'Trainer', optional: true },
  { key: 'registrations', label: 'Registrations', optional: true },
  { key: 'review', label: 'Review' },
];

const emptyForm = {
  name: '', trainer_id: '', trainer_name: '', trainer_first_name: '', trainer_last_name: '',
  trainer_email: '', sex: '', sire_name: '', dam_name: '', foaling_date: '',
  breed_ids: [] as string[], color_id: '', is_solid_paint_bred: false,
};
const emptyOwner = { mode: 'self' as OwnerMode, firstName: '', lastName: '', email: '' };
const emptyNewReg = { association_id: '', association_type: null as AssociationType | null, registration_number: '' };

const PRIMARY_BUTTON = { backgroundColor: '#2c1810', color: '#f5ede0' };
const PANEL_STYLE = { borderColor: '#d4b896', backgroundColor: '#ffffff' };

interface Props {
  exhibitorId: string;
  /** Horses already on the profile, so search hits can be labelled as such. */
  profileHorseIds: Set<string>;
  /** Carried over when the "find a horse" search came up empty, so the exhibitor
   *  doesn't retype what they just searched for. */
  initialName?: string;
  initialRegAssociationId?: string;
  initialRegNumber?: string;
  /** A brand-new horse record was created. */
  onCreated: (horse: MyHorse) => void;
  /** The horse already existed and was linked to the profile instead. */
  onLinked: (horse: MyHorse) => void;
  onCancel: () => void;
}

function StepBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: '#f0e4d0', color: '#8b7355' }}>
      {children}
    </span>
  );
}

function ReviewRow({ label, value, skipped }: { label: string; value?: React.ReactNode; skipped?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
      <span className="text-xs uppercase tracking-wide" style={{ color: '#a89070' }}>{label}</span>
      {skipped
        ? <span className="text-sm italic" style={{ color: '#a89070' }}>Skipped</span>
        : <span className="text-sm text-right" style={{ color: '#2c1810' }}>{value}</span>}
    </div>
  );
}

export default function AddHorseWizard({
  exhibitorId, profileHorseIds,
  initialName, initialRegAssociationId, initialRegNumber,
  onCreated, onLinked, onCancel,
}: Props) {
  const [breeds, setBreeds] = useState<Breed[]>([]);
  const [colors, setColors] = useState<HorseColor[]>([]);
  const [associations, setAssociations] = useState<Association[]>([]);

  const [stepIndex, setStepIndex] = useState(0);
  // Steps already cleared, so the indicator can jump back without re-validating.
  const [furthest, setFurthest] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);

  const [form, setForm] = useState({ ...emptyForm, name: initialName ?? '' });
  const [owner, setOwner] = useState(emptyOwner);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ride-mode search: the exhibitor must look for the horse before they are
  // allowed to type owner + horse details by hand.
  const [rideQuery, setRideQuery] = useState('');
  const [rideResults, setRideResults] = useState<SearchMatch[] | null>(null);
  const [rideSearching, setRideSearching] = useState(false);
  const [rideMessage, setRideMessage] = useState<string | null>(null);
  const [manualEntry, setManualEntry] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);

  const [pendingRegs, setPendingRegs] = useState<PendingReg[]>([]);
  const [newReg, setNewReg] = useState(emptyNewReg);
  const [regError, setRegError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/breeds').then((r) => r.json()).then(setBreeds).catch(() => {});
    fetch('/api/horse-colors').then((r) => r.json()).then(setColors).catch(() => {});
    fetch('/api/associations').then((r) => r.json()).then(setAssociations).catch(() => {});
  }, []);

  // A registration carried in from the search arrives as bare ids, so it can only
  // be turned into a chip once the association registry has loaded.
  useEffect(() => {
    if (!initialRegAssociationId || !initialRegNumber) return;
    const match = associations.find((a) => a.id === initialRegAssociationId);
    if (!match) return;
    setPendingRegs((prev) => (prev.length > 0 ? prev : [{
      association_id: match.id,
      association_code: match.code,
      association_name: match.name,
      association_type: match.association_type,
      registration_number: initialRegNumber,
    }]));
  }, [associations, initialRegAssociationId, initialRegNumber]);

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  const usedAssociationIds = new Set(pendingRegs.map((r) => r.association_id));
  const availableAssociations = associations.filter((a) => !usedAssociationIds.has(a.id));

  /** Whatever blocks leaving this step, or null when it's good to go. */
  const stepIssue = (key: StepKey): string | null => {
    if (key === 'owner') {
      if (owner.mode === 'ride' && !manualEntry) {
        return 'Search for the horse first. If it is already in the app, add it from the results instead of creating a second record.';
      }
      if (owner.mode === 'ride' && (!owner.firstName.trim() || !owner.lastName.trim() || !owner.email.trim())) {
        return "Owner first name, last name, and email are all required for a horse you don't own.";
      }
    }
    if (key === 'horse' && !form.name.trim()) return 'Horse name is required.';
    if (key === 'trainer') {
      const hasOtherTrainer = !form.trainer_id && (
        form.trainer_first_name.trim() || form.trainer_last_name.trim() || form.trainer_email.trim()
      );
      if (hasOtherTrainer && (!form.trainer_first_name.trim() || !form.trainer_last_name.trim() || !form.trainer_email.trim())) {
        return 'Trainer first name, last name, and email are required when adding a new trainer.';
      }
    }
    return null;
  };

  /** Optional steps offer Skip only while genuinely empty — once something is
   *  entered, "skip" would be ambiguous about whether it discards the input. */
  const stepHasData = (key: StepKey): boolean => {
    if (key === 'trainer') {
      return !!(form.trainer_id || form.trainer_name.trim() || form.trainer_first_name.trim()
        || form.trainer_last_name.trim() || form.trainer_email.trim());
    }
    if (key === 'registrations') return pendingRegs.length > 0;
    return true;
  };

  const goTo = (index: number) => {
    setStepError(null);
    setStepIndex(index);
    setFurthest((f) => Math.max(f, index));
  };

  const goNext = () => {
    const issue = stepIssue(step.key);
    if (issue) { setStepError(issue); return; }
    goTo(Math.min(stepIndex + 1, STEPS.length - 1));
  };

  const goBack = () => { setStepError(null); setStepIndex((i) => Math.max(i - 1, 0)); };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleOwnerMode = (mode: OwnerMode) => {
    setOwner((prev) => ({ ...prev, mode }));
    setStepError(null);
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

  const handleLinkExisting = async (horseId: string) => {
    setLinkingId(horseId);
    const res = await fetch(`/api/exhibitors/${exhibitorId}/linked-horses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ horse_id: horseId }),
    });
    setLinkingId(null);
    if (res.ok) {
      onLinked(await res.json());
      return;
    }
    const err = await res.json().catch(() => ({}));
    setRideMessage(err.detail ?? 'Failed to add horse to your profile.');
  };

  const handleAddReg = async () => {
    if (!newReg.association_id || !newReg.registration_number.trim()) {
      setRegError('Select an association and enter a registration number.');
      return;
    }
    const trimmed = newReg.registration_number.trim();
    const st = associations.find((s) => s.id === newReg.association_id)!;

    // Check whether this number is already on file for a different horse.
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
      association_id: st.id,
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

  const handleCreate = async () => {
    // Re-check every step: the indicator lets the user jump back and change
    // an answer after a later step was already cleared.
    for (let i = 0; i < STEPS.length; i++) {
      const issue = stepIssue(STEPS[i].key);
      if (issue) { setStepError(issue); setStepIndex(i); return; }
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
      trainer_id: form.trainer_id || null,
      trainer_name: form.trainer_name.trim() || null,
      trainer_first_name: form.trainer_first_name.trim() || null,
      trainer_last_name: form.trainer_last_name.trim() || null,
      trainer_email: form.trainer_email.trim() || null,
      breed_ids: form.breed_ids,
    };
    if (form.sex) body.sex = form.sex;
    if (form.sire_name.trim()) body.sire_name = form.sire_name.trim();
    if (form.dam_name.trim()) body.dam_name = form.dam_name.trim();
    if (form.foaling_date) body.foaling_date = form.foaling_date;
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
    onCreated(await res.json());
  };

  const breedLabel = form.breed_ids
    .map((id) => breeds.find((b) => b.id === id)?.name)
    .filter(Boolean)
    .join(', ');
  const trainerLabel = form.trainer_name.trim()
    || [form.trainer_first_name.trim(), form.trainer_last_name.trim()].filter(Boolean).join(' ');
  const ownerSummary = owner.mode === 'self'
    ? 'You own this horse'
    : `${owner.firstName} ${owner.lastName} (${owner.email})`.trim();

  return (
    <div className="border rounded-lg p-4 space-y-4" style={PANEL_STYLE}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold" style={{ color: '#2c1810' }}>{step.label}</span>
        <span className="text-xs" style={{ color: '#8b7355' }}>Step {stepIndex + 1} of {STEPS.length}</span>
      </div>

      {/* Step indicator — cleared steps stay reachable so answers can be revised. */}
      <ol className="flex flex-wrap gap-1.5">
        {STEPS.map((s, i) => {
          const active = i === stepIndex;
          const reachable = i <= furthest;
          return (
            <li key={s.key}>
              <button
                onClick={() => reachable && goTo(i)}
                disabled={!reachable}
                title={reachable ? `Go to ${s.label}` : 'Finish the earlier steps first'}
                aria-current={active ? 'step' : undefined}
                className="px-2.5 py-1 rounded text-xs font-medium border disabled:opacity-50 disabled:cursor-not-allowed"
                style={active
                  ? { backgroundColor: '#2c1810', color: '#f5ede0', borderColor: '#2c1810' }
                  : { backgroundColor: '#ffffff', color: '#8b7355', borderColor: '#d4b896' }}
              >
                {i + 1}. {s.label}
              </button>
            </li>
          );
        })}
      </ol>

      {/* ---- Step 1: Owner (required) ---- */}
      {step.key === 'owner' && (
        <div className="space-y-3">
          <p className="text-xs font-medium" style={{ color: '#2c1810' }}>Is this your horse? *</p>
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="ownerMode" checked={owner.mode === 'self'} onChange={() => handleOwnerMode('self')} className="h-4 w-4" />
              <span className="text-sm" style={{ color: '#2c1810' }}>I own this horse</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="ownerMode" checked={owner.mode === 'ride'} onChange={() => handleOwnerMode('ride')} className="h-4 w-4" />
              <span className="text-sm" style={{ color: '#2c1810' }}>I ride this horse, but do not own it</span>
            </label>
          </div>

          {owner.mode === 'ride' && !manualEntry && (
            <div className="space-y-3 pt-2 border-t" style={{ borderColor: '#e8d5b7' }}>
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
                <button onClick={handleRideSearch} disabled={rideSearching} className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50" style={PRIMARY_BUTTON}>
                  {rideSearching ? 'Searching...' : 'Search'}
                </button>
              </div>

              {rideResults && rideResults.length > 0 && (
                <SearchResultList
                  results={rideResults}
                  existingIds={profileHorseIds}
                  onSelect={handleLinkExisting}
                  busyId={linkingId}
                  actionLabel="Select this horse"
                />
              )}

              {rideMessage && <p className="text-xs" style={{ color: '#8b4513' }}>{rideMessage}</p>}

              {rideResults && (
                <button
                  onClick={() => {
                    setManualEntry(true);
                    setStepError(null);
                    // Carry the search term over as the horse name when it isn't a reg number.
                    if (!form.name.trim() && /[a-z]/i.test(rideQuery)) {
                      setForm((prev) => ({ ...prev, name: rideQuery.trim() }));
                    }
                  }}
                  className="text-xs font-medium hover:underline"
                  style={{ color: '#2c1810' }}
                >
                  Not in the app? Enter the owner details -&gt;
                </button>
              )}
            </div>
          )}

          {owner.mode === 'ride' && manualEntry && (
            <div className="space-y-2 pt-2 border-t" style={{ borderColor: '#e8d5b7' }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium" style={{ color: '#2c1810' }}>Horse Owner *</p>
                <button onClick={() => { setManualEntry(false); setStepError(null); }} className="text-xs hover:underline" style={{ color: '#8b7355' }}>
                  &lt;- Back to search
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input placeholder="Owner first name *" value={owner.firstName} onChange={(e) => setOwner((p) => ({ ...p, firstName: e.target.value }))} className="border rounded px-3 py-2 text-sm" style={{ borderColor: '#d4b896' }} />
                <input placeholder="Owner last name *" value={owner.lastName} onChange={(e) => setOwner((p) => ({ ...p, lastName: e.target.value }))} className="border rounded px-3 py-2 text-sm" style={{ borderColor: '#d4b896' }} />
                <input type="email" placeholder="Owner email *" value={owner.email} onChange={(e) => setOwner((p) => ({ ...p, email: e.target.value }))} className="border rounded px-3 py-2 text-sm sm:col-span-2" style={{ borderColor: '#d4b896' }} />
                <p className="text-xs sm:col-span-2" style={{ color: '#8b7355' }}>
                  If the owner already has an account, their existing profile will be linked automatically.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- Step 2: Horse (name required, rest optional) ---- */}
      {step.key === 'horse' && (
        <div className="space-y-3">
          <p className="text-xs" style={{ color: '#8b7355' }}>
            Only the name is required — everything else can be added later from the horse&rsquo;s own page.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="col-span-full">
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Horse name *</label>
              <input name="name" placeholder="Registered or barn name" value={form.name} onChange={handleChange} className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: '#d4b896' }} />
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Sex</label>
              <select name="sex" value={form.sex} onChange={handleChange} className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: '#d4b896' }}>
                <option value="">- Not specified -</option>
                <option value="Mare">Mare</option>
                <option value="Gelding">Gelding</option>
                <option value="Stallion">Stallion</option>
              </select>
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Foaling Date</label>
              <input name="foaling_date" type="date" value={form.foaling_date} onChange={handleChange} className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: '#d4b896' }} />
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Sire</label>
              <input name="sire_name" value={form.sire_name} onChange={handleChange} maxLength={200} placeholder="Registered name" className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: '#d4b896' }} />
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Dam</label>
              <input name="dam_name" value={form.dam_name} onChange={handleChange} maxLength={200} placeholder="Registered name" className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: '#d4b896' }} />
            </div>
            <div className="col-span-full">
              <BreedCheckboxGroup breeds={breeds} selectedIds={form.breed_ids} onChange={(breed_ids) => setForm((prev) => ({ ...prev, breed_ids }))} />
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Color</label>
              <select name="color_id" value={form.color_id} onChange={handleChange} className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: '#d4b896' }}>
                <option value="">- Not specified -</option>
                {colors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2 col-span-full">
              <input type="checkbox" id="spb_new" checked={form.is_solid_paint_bred} onChange={(e) => setForm((prev) => ({ ...prev, is_solid_paint_bred: e.target.checked }))} className="h-4 w-4" />
              <label htmlFor="spb_new" className="text-sm" style={{ color: '#8b7355' }}>Solid Paint-Bred (SPB)</label>
            </div>
          </div>
        </div>
      )}

      {/* ---- Step 3: Trainer (optional) ---- */}
      {step.key === 'trainer' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium" style={{ color: '#2c1810' }}>Trainer</p>
            <StepBadge>Optional</StepBadge>
          </div>
          <p className="text-xs" style={{ color: '#8b7355' }}>
            Pick a trainer already in the app, or add a new one by name and email. Leave it blank if the horse has no trainer.
          </p>
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
      )}

      {/* ---- Step 4: Registrations (optional) ---- */}
      {step.key === 'registrations' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium" style={{ color: '#2c1810' }}>Registrations &amp; Memberships</p>
            <StepBadge>Optional</StepBadge>
          </div>
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
                      <li key={r.association_id} className="flex items-center justify-between p-2 rounded text-sm" style={REG_CHIP_STYLES[kind]}>
                        <span>
                          <span className="font-mono font-semibold mr-2">{r.association_code}</span>
                          {r.registration_number}
                        </span>
                        <button onClick={() => handleRemoveReg(r.association_id)} className="text-xs text-red-600 hover:text-red-800 ml-3">Remove</button>
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
                        style={{ borderColor: '#d4b896' }}
                      >
                        <option value="">{kind === 'breed' ? 'Breed registry...' : 'Club...'}</option>
                        {options.map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
                      </select>
                    </div>
                    <div className="flex-1 min-w-[120px]">
                      <input
                        value={newReg.association_type === kind ? newReg.registration_number : ''}
                        onChange={(e) => setNewReg((p) => ({ ...p, association_type: kind, registration_number: e.target.value }))}
                        placeholder={kind === 'breed' ? 'Reg #' : 'Member #'}
                        className="w-full border rounded px-3 py-2 text-sm"
                        style={{ borderColor: '#d4b896' }}
                      />
                    </div>
                    <button
                      onClick={handleAddReg}
                      disabled={newReg.association_type !== kind}
                      title={newReg.association_type !== kind ? 'Pick an association and enter a number first' : undefined}
                      className="px-3 py-2 rounded text-sm font-medium disabled:opacity-50"
                      style={PRIMARY_BUTTON}
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

      {/* ---- Step 5: Review ---- */}
      {step.key === 'review' && (
        <div className="space-y-3">
          <p className="text-xs" style={{ color: '#8b7355' }}>
            Check it over. Anything skipped can be filled in later from the horse&rsquo;s page.
          </p>
          <div className="rounded border divide-y px-3" style={{ borderColor: '#e8d5b7', backgroundColor: '#ffffff' }}>
            <ReviewRow label="Owner" value={ownerSummary} />
            <ReviewRow label="Name" value={form.name.trim()} />
            <ReviewRow label="Sex" value={form.sex} skipped={!form.sex} />
            <ReviewRow label="Foaling Date" value={form.foaling_date} skipped={!form.foaling_date} />
            <ReviewRow label="Sire" value={form.sire_name.trim()} skipped={!form.sire_name.trim()} />
            <ReviewRow label="Dam" value={form.dam_name.trim()} skipped={!form.dam_name.trim()} />
            <ReviewRow label="Breeds" value={breedLabel} skipped={!breedLabel} />
            <ReviewRow label="Color" value={colors.find((c) => c.id === form.color_id)?.name} skipped={!form.color_id} />
            <ReviewRow label="SPB" value={form.is_solid_paint_bred ? 'Yes' : 'No'} />
            <ReviewRow label="Trainer" value={trainerLabel} skipped={!trainerLabel} />
            <ReviewRow
              label="Registrations"
              value={pendingRegs.map((r) => `${r.association_code} ${r.registration_number}`).join(', ')}
              skipped={pendingRegs.length === 0}
            />
          </div>
        </div>
      )}

      {stepError && <p className="text-red-600 text-xs">{stepError}</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}

      {/* Footer nav */}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t" style={{ borderColor: '#e8d5b7' }}>
        <div className="flex flex-wrap gap-2 pt-3">
          {stepIndex > 0 && (
            <button onClick={goBack} className="px-4 py-2 rounded text-sm border" style={{ borderColor: '#d4b896', color: '#8b7355' }}>
              Back
            </button>
          )}
          {isLast ? (
            <button onClick={handleCreate} disabled={saving} className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50" style={PRIMARY_BUTTON}>
              {saving ? 'Saving...' : 'Create Horse'}
            </button>
          ) : (
            <button onClick={goNext} className="px-4 py-2 rounded text-sm font-medium" style={PRIMARY_BUTTON}>
              Next
            </button>
          )}
          {!isLast && step.optional && !stepHasData(step.key) && (
            <button onClick={() => goTo(stepIndex + 1)} className="px-4 py-2 rounded text-sm border" style={{ borderColor: '#d4b896', color: '#8b7355' }}>
              Skip
            </button>
          )}
        </div>
        <button onClick={onCancel} className="ml-auto mt-3 text-xs hover:underline" style={{ color: '#8b7355' }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
