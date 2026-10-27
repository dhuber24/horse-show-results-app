'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import ApprovalLinkCallout from '@/components/ApprovalLinkCallout';
import BreedCheckboxGroup from '@/components/BreedCheckboxGroup';
import { nextSuggestedAssociation } from '@/lib/breed-associations';
import TrainerSelect from '@/components/TrainerSelect';
import { DOC_TYPES, HEALTH_DOC_TYPES, MAX_DOC_BYTES } from '@/components/HorseDocuments';
import {
  DETAIL_FIELDS,
  ExtractionResponse,
  FIELD_LABELS,
  WIDE_DETAIL_FIELDS,
  analyzeDocument,
  asText,
  reviewWarnings,
  twelveMonthsAfter,
} from '@/lib/document-extraction';
import {
  Association,
  AssociationType,
  Breed,
  HorseColor,
  HorsePattern,
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

type StepKey = 'owner' | 'horse' | 'trainer' | 'health' | 'registrations' | 'review';

/**
 * Only Owner and Horse gate creation; everything else can be skipped and filled
 * in later from the horse's own page. Step order mirrors the tabs on that page.
 *
 * `ownerOnly` steps are dropped in ride mode, where the backend would discard
 * the answer anyway: the documents endpoint only lets the horse's registered
 * owner upload, and the trainer is the owner's to name — a horse you only ride
 * has its trainer set from the owner's side.
 */
const STEPS: { key: StepKey; label: string; optional?: boolean; ownerOnly?: boolean }[] = [
  { key: 'owner', label: 'Owner' },
  { key: 'horse', label: 'Horse' },
  { key: 'trainer', label: 'Trainer', optional: true, ownerOnly: true },
  { key: 'health', label: 'Health', optional: true, ownerOnly: true },
  { key: 'registrations', label: 'Registrations', optional: true },
  { key: 'review', label: 'Review' },
];

/**
 * What `POST /exhibitors/{id}/created-horses` returns: the horse, plus the
 * request waiting on its owner when the horse was filed against somebody who
 * already has an account. See `CreatedHorseResult` in the backend schemas.
 */
type CreatedHorseResult = MyHorse & {
  pending_owner_approval?: boolean;
  approval_url?: string | null;
  approver_name?: string | null;
  approval_email_sent?: boolean | null;
};

/** A health document attached in the browser. It can only be uploaded once the
 *  horse exists, so the wizard holds these and posts them after creation. A
 *  file is attached the moment it is chosen; its type and dates are edited on
 *  the attached row, pre-filled when the file could be read. */
interface PendingDoc {
  key: string;
  file: File;
  document_type: string;
  issue_date: string;
  expiry_date: string;
  /** The file is still being read, so its fields may yet fill in. */
  reading: boolean;
  /** What was read off the file. Its id links the read to the document when
   *  the document is finally saved, so provenance survives the wait. */
  extraction: ExtractionResponse | null;
}

type DocFields = Pick<PendingDoc, 'document_type' | 'issue_date' | 'expiry_date'>;

const HEALTH_DOC_OPTIONS = DOC_TYPES.filter((t) => HEALTH_DOC_TYPES.includes(t.value));

const emptyForm = {
  name: '', barn_name: '',
  trainer_id: '', trainer_name: '', trainer_first_name: '', trainer_last_name: '',
  trainer_email: '', sex: '', sire_name: '', dam_name: '', foaling_date: '',
  breed_ids: [] as string[], color_id: '', pattern_id: '', is_solid_paint_bred: false,
};
const emptyOwner = { mode: 'self' as OwnerMode, firstName: '', lastName: '', email: '' };
const emptyNewReg = { association_id: '', association_type: null as AssociationType | null, registration_number: '' };

const PRIMARY_BUTTON = { backgroundColor: 'var(--foreground)', color: 'var(--bg-subtle)' };
const PANEL_STYLE = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)' };

/**
 * The wizard's answers, kept in the browser so leaving does not lose them.
 *
 * **Not a server autosave, because there is nothing to save to.** The horse row
 * does not exist until the last step — creating one early to PATCH as they go
 * would leave half-finished horses on profiles and, in ride mode, fire an
 * owner-approval request for a horse nobody finished adding. So the draft lives
 * in `localStorage`, which is per-browser and per-exhibitor and disappears the
 * moment the wizard succeeds.
 *
 * **Documents are deliberately not in it.** A staged `File` cannot be
 * serialised, and a draft that silently restored a document list with no bytes
 * behind it would be worse than one that says nothing — the Health step is
 * where somebody re-attaches, and the count on screen is the truth.
 *
 * Every read and write is wrapped: a private window, cleared site data or a
 * browser set to block storage all throw on access, and none of that is a
 * reason for the form itself to break.
 */
type HorseDraft = {
  form: typeof emptyForm;
  owner: typeof emptyOwner;
  pendingRegs: PendingReg[];
  stepIndex: number;
  furthest: number;
};

const draftKey = (exhibitorId: string) => `gaitdesk:add-horse:${exhibitorId}`;

function readDraft(exhibitorId: string): HorseDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(exhibitorId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HorseDraft>;
    if (!parsed || typeof parsed !== 'object' || !parsed.form) return null;
    return {
      // Spread over the empty shapes rather than trusting what came back: a
      // draft written by an older build is missing whatever has been added
      // since, and `form.breed_ids.includes` on an undefined throws.
      form: { ...emptyForm, ...parsed.form },
      owner: { ...emptyOwner, ...(parsed.owner ?? {}) },
      pendingRegs: Array.isArray(parsed.pendingRegs) ? parsed.pendingRegs : [],
      stepIndex: typeof parsed.stepIndex === 'number' ? parsed.stepIndex : 0,
      furthest: typeof parsed.furthest === 'number' ? parsed.furthest : 0,
    };
  } catch {
    return null;
  }
}

function writeDraft(exhibitorId: string, draft: HorseDraft): void {
  try {
    window.localStorage.setItem(draftKey(exhibitorId), JSON.stringify(draft));
  } catch {
    /* Storage unavailable or full — the form still works, it just will not
       survive a reload. Nothing here is worth an error message. */
  }
}

function clearDraft(exhibitorId: string): void {
  try {
    window.localStorage.removeItem(draftKey(exhibitorId));
  } catch {
    /* See writeDraft. */
  }
}

/** Whether a restored draft holds anything worth telling somebody about. A
 *  draft that is only "they opened the wizard" should restore silently. */
function draftHasContent(draft: HorseDraft): boolean {
  return Boolean(
    draft.form.name.trim() ||
    draft.form.barn_name.trim() ||
    draft.form.breed_ids.length ||
    draft.form.sire_name.trim() ||
    draft.form.dam_name.trim() ||
    draft.form.foaling_date ||
    draft.pendingRegs.length ||
    draft.owner.firstName.trim() ||
    draft.owner.lastName.trim(),
  );
}

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
  /** The way out once a horse exists or is waiting on its owner — the screen
   *  `onCancel` returns to. My Horses unless the caller is somewhere else. */
  returnLabel?: string;
}

function StepBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--muted)' }}>
      {children}
    </span>
  );
}

function ReviewRow({ label, value, skipped }: { label: string; value?: React.ReactNode; skipped?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
      <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-dimmed)' }}>{label}</span>
      {skipped
        ? <span className="text-sm italic" style={{ color: 'var(--text-dimmed)' }}>Skipped</span>
        : <span className="text-sm text-right" style={{ color: 'var(--foreground)' }}>{value}</span>}
    </div>
  );
}

/**
 * One attached health document: its type and dates, filled from the read where
 * there was one, with what was read shown underneath to check them against.
 * Nothing here is saved — the document uploads when the horse is created.
 */
function AttachedDoc({ doc, onChange, onRemove }: {
  doc: PendingDoc;
  onChange: (patch: Partial<DocFields>) => void;
  onRemove: () => void;
}) {
  const fields = doc.extraction?.fields ?? {};
  const lowConfidence = doc.extraction?.low_confidence_fields ?? [];
  const details = DETAIL_FIELDS
    .map((key) => [key, asText(fields[key])] as const)
    .filter((pair): pair is readonly [string, string] => pair[1] !== null);

  const testDate = asText(fields.test_date);
  const derivedExpiry =
    doc.extraction && doc.document_type === 'COGGINS' && !doc.expiry_date && testDate
      ? twelveMonthsAfter(testDate)
      : null;

  /** Marks how a value got into the field, matching the horse-page form. */
  const fieldHint = (key: string) => {
    if (!doc.extraction) return null;
    if (lowConfidence.includes(key)) {
      return <span className="text-xs ml-1" style={{ color: 'var(--warning)' }}>· check this</span>;
    }
    if (asText(fields[key])) {
      return <span className="text-xs ml-1" style={{ color: 'var(--success)' }}>· read from document</span>;
    }
    return <span className="text-xs ml-1" style={{ color: 'var(--text-dimmed)' }}>· not on the document</span>;
  };

  return (
    <li className="rounded border p-3 space-y-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-medium break-all" style={{ color: 'var(--foreground)' }}>{doc.file.name}</span>
        <button onClick={onRemove} className="text-xs text-red-600 hover:text-red-800 shrink-0">
          Remove
        </button>
      </div>

      {doc.reading && (
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Reading the document to fill in the dates...
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>
            Document Type *{fieldHint('document_type')}
          </label>
          <select
            value={doc.document_type}
            onChange={(e) => onChange({ document_type: e.target.value })}
            className="w-full border rounded px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
          >
            <option value="">Select...</option>
            {HEALTH_DOC_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>
            Issue Date *{fieldHint('issue_date')}
          </label>
          <input
            type="date"
            value={doc.issue_date}
            onChange={(e) => onChange({ issue_date: e.target.value })}
            className="w-full border rounded px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
          />
        </div>
        <div>
          <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>
            Expiry Date *{fieldHint('expiry_date')}
          </label>
          <input
            type="date"
            value={doc.expiry_date}
            onChange={(e) => onChange({ expiry_date: e.target.value })}
            className="w-full border rounded px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
          />
          {derivedExpiry && (
            <button
              type="button"
              onClick={() => onChange({ expiry_date: derivedExpiry })}
              className="text-xs mt-1 hover:underline text-left"
              style={{ color: 'var(--accent)' }}
            >
              No expiry printed. Use {derivedExpiry} — 12 months from the{' '}
              {testDate} blood draw?
            </button>
          )}
        </div>
      </div>

      {doc.extraction && (
        <div className="rounded border p-3 space-y-2" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
          <p className="text-xs font-semibold" style={{ color: 'var(--text-deep)' }}>
            Read from the document — check the type and dates above
          </p>
          {reviewWarnings(fields).map((warning) => (
            <p
              key={warning}
              className="text-xs font-medium rounded px-2 py-1.5"
              style={{ color: 'var(--error-strong)', backgroundColor: 'var(--error-bg)' }}
            >
              {warning}
            </p>
          ))}
          {doc.extraction.notes && (
            <p className="text-xs" style={{ color: 'var(--warning)' }}>{doc.extraction.notes}</p>
          )}
          {lowConfidence.length > 0 && (
            <p className="text-xs" style={{ color: 'var(--warning)' }}>
              Hard to read: {lowConfidence.map((k) => FIELD_LABELS[k] ?? k).join(', ')}.
            </p>
          )}
          {details.length > 0 && (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {details.map(([key, value]) => (
                <div key={key} className={`flex gap-2${WIDE_DETAIL_FIELDS.has(key) ? ' sm:col-span-2' : ''}`}>
                  <dt className="shrink-0" style={{ color: 'var(--muted)' }}>
                    {FIELD_LABELS[key] ?? key}:
                  </dt>
                  <dd className={WIDE_DETAIL_FIELDS.has(key) ? 'break-words' : 'truncate'} style={{ color: 'var(--foreground)' }}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <p className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
            These details are shown so you can verify the document is the right one. Only the
            type and dates above are saved.
          </p>
        </div>
      )}
    </li>
  );
}

export default function AddHorseWizard({
  exhibitorId, profileHorseIds,
  initialName, initialRegAssociationId, initialRegNumber,
  onCreated, onLinked, onCancel, returnLabel = 'Back to My Horses',
}: Props) {
  const [breeds, setBreeds] = useState<Breed[]>([]);
  const [colors, setColors] = useState<HorseColor[]>([]);
  const [patterns, setPatterns] = useState<HorsePattern[]>([]);
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

  const [pendingDocs, setPendingDocs] = useState<PendingDoc[]>([]);
  const [docError, setDocError] = useState<string | null>(null);
  // Set once the horse row exists. Creation must not be offered again after
  // this point — a retry would create a duplicate horse.
  const [createdHorseId, setCreatedHorseId] = useState<string | null>(null);
  // Same rule, other ending: the horse was filed against an owner who has to
  // approve before it reaches this profile.
  const [pendingApproval, setPendingApproval] = useState<{
    horseName: string;
    approverName: string;
    url: string;
    emailSent: boolean | null;
  } | null>(null);


  // Restore whatever was typed last time, once, on mount. `useState` cannot do
  // this in its initialiser because `localStorage` does not exist while the
  // component renders on the server; an effect runs only in the browser.
  const [draftRestored, setDraftRestored] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  useEffect(() => {
    const saved = readDraft(exhibitorId);
    if (saved) {
      // A name carried in from the search that came up empty wins over the
      // draft's — it is what they just typed, and this second.
      setForm(initialName ? { ...saved.form, name: initialName } : saved.form);
      setOwner(saved.owner);
      setPendingRegs(saved.pendingRegs);
      setStepIndex(saved.stepIndex);
      setFurthest(saved.furthest);
      if (draftHasContent(saved)) setDraftRestored(true);
    }
    setDraftLoaded(true);
  }, [exhibitorId, initialName]);

  // Write on every change, once the restore has run. The guard is what stops
  // the first render — with everything still empty — overwriting the draft it
  // is about to load.
  useEffect(() => {
    if (!draftLoaded) return;
    if (createdHorseId) return;
    writeDraft(exhibitorId, { form, owner, pendingRegs, stepIndex, furthest });
  }, [draftLoaded, createdHorseId, exhibitorId, form, owner, pendingRegs, stepIndex, furthest]);

  /** Throw the draft away and start from an empty form. */
  const discardDraft = () => {
    clearDraft(exhibitorId);
    setForm({ ...emptyForm, name: initialName ?? '' });
    setOwner(emptyOwner);
    setPendingRegs([]);
    setPendingDocs([]);
    setStepIndex(0);
    setFurthest(0);
    setDraftRestored(false);
  };

  useEffect(() => {
    fetch('/api/breeds').then((r) => r.json()).then(setBreeds).catch(() => {});
    fetch('/api/horse-colors').then((r) => r.json()).then(setColors).catch(() => {});
    fetch('/api/horse-patterns').then((r) => r.json()).then(setPatterns).catch(() => {});
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

  // Ride mode drops the owner-only Health step, so the list — and every index
  // into it — depends on the answer given back on step 1.
  const steps = useMemo(
    () => STEPS.filter((s) => !s.ownerOnly || owner.mode === 'self'),
    [owner.mode]
  );
  const lastIndex = steps.length - 1;
  const safeIndex = Math.min(stepIndex, lastIndex);
  const step = steps[safeIndex];
  const isLast = safeIndex === lastIndex;

  const usedAssociationIds = new Set(pendingRegs.map((r) => r.association_id));
  const availableAssociations = associations.filter((a) => !usedAssociationIds.has(a.id));

  // The registry the breeds ticked on the Horse step imply and that has no
  // number against it yet. Somebody who has just said "American Paint Horse"
  // should not have to find APHA again, two steps later, in a dropdown of every
  // body the app knows.
  const selectedBreeds = breeds.filter((b) => form.breed_ids.includes(b.id));
  const suggestedAssociation = nextSuggestedAssociation(
    selectedBreeds,
    associations,
    usedAssociationIds,
  );

  // Preselect that registry, once, when the Registrations step is reached with
  // the picker empty. Guarded on the box being blank, so it never overwrites a
  // choice and never fires twice for the same one — which is what keeps it out
  // of the loop that seeding state from state usually is. It fires again after
  // an Add, because `newReg` resets and `suggestedAssociation` has moved on to
  // the next breed: a horse papered with two bodies gets both picked for it.
  useEffect(() => {
    if (step.key !== 'registrations') return;
    if (newReg.association_id) return;
    if (!suggestedAssociation) return;
    setNewReg((prev) => ({
      ...prev,
      association_id: suggestedAssociation.id,
      association_type: 'breed',
    }));
  }, [step.key, newReg.association_id, suggestedAssociation]);

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
    if (key === 'horse' && !form.name.trim()) return 'Registered name is required.';
    if (key === 'health') {
      // Waiting out the read means the values are on screen to check before
      // anybody moves past them, rather than filling in behind their back.
      const reading = pendingDocs.find((d) => d.reading);
      if (reading) return `Still reading ${reading.file.name} — give it a moment.`;
      const incomplete = pendingDocs.find((d) => !d.document_type || !d.issue_date || !d.expiry_date);
      if (incomplete) {
        return `Pick the document type and both dates for ${incomplete.file.name}, or remove it.`;
      }
    }
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
    if (key === 'health') return pendingDocs.length > 0;
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
    goTo(Math.min(safeIndex + 1, lastIndex));
  };

  const goBack = () => { setStepError(null); setStepIndex(Math.max(safeIndex - 1, 0)); };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleOwnerMode = (mode: OwnerMode) => {
    setOwner((prev) => ({ ...prev, mode }));
    setStepError(null);
    // Both owner-only steps disappear in ride mode, so drop what was staged
    // under them rather than posting values the backend will discard.
    if (mode === 'ride') {
      setPendingDocs([]);
      setDocError(null);
      setForm((prev) => ({
        ...prev,
        trainer_id: '', trainer_name: '', trainer_first_name: '',
        trainer_last_name: '', trainer_email: '',
      }));
    }
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
      clearDraft(exhibitorId);
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

    // The lookup answers 200 = already on file for some horse, 404 = clear.
    // Anything else means the check never ran, so refuse rather than fail open
    // and silently accept a number that may belong to another horse.
    const qs = new URLSearchParams({ association_id: newReg.association_id, registration_number: trimmed });
    let lookupRes: Response;
    try {
      lookupRes = await fetch(`/api/horses/registrations/lookup?${qs.toString()}`);
    } catch {
      setRegError('Could not check whether that number is already on file. Check your connection and try again.');
      return;
    }
    if (lookupRes.ok) {
      const existing = await lookupRes.json();
      const ownerLabel = existing.owner_name ? ` (owner: ${existing.owner_name})` : '';
      setRegError(
        `${st.code} #${trimmed} is already on file for horse "${existing.horse_name}"${ownerLabel}. ` +
        `If this is the same horse, contact your show secretary.`
      );
      return;
    }
    if (lookupRes.status !== 404) {
      setRegError('Could not check whether that number is already on file. Try again in a moment.');
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

  /**
   * Attach the chosen file at once, then read it and fill in its type and dates.
   * There is no horse yet, so this uses the unattached endpoint and the
   * extraction is claimed later, when the document is actually saved.
   *
   * Attaching is not saving. What was read sits in the attached row's fields to
   * check and change, and nothing reaches the horse until Create Horse on the
   * Review step, which lists every document's type and expiry — the human save
   * the horse-page form gets by suppressing its auto-upload shortcut.
   */
  const handleAttachDoc = async (file: File | null) => {
    setDocError(null);
    if (!file) return;
    if (file.size > MAX_DOC_BYTES) { setDocError(`${file.name} is too large (max 10 MB).`); return; }

    const key = `${file.name}-${Date.now()}`;
    setPendingDocs((prev) => [...prev, {
      key, file, document_type: '', issue_date: '', expiry_date: '', reading: true, extraction: null,
    }]);

    const read = await analyzeDocument(file);
    const f = read?.fields ?? {};
    const readType = asText(f.document_type);
    // Removed while it was being read: the map finds nothing and that is fine.
    setPendingDocs((prev) => prev.map((d) => (d.key !== key ? d : {
      ...d,
      reading: false,
      extraction: read,
      // Only a health type, since that is all this step's picker offers; a
      // read that took the file for registration papers leaves it to choose.
      document_type: readType && HEALTH_DOC_TYPES.includes(readType) ? readType : d.document_type,
      issue_date: asText(f.issue_date) ?? d.issue_date,
      expiry_date: asText(f.expiry_date) ?? d.expiry_date,
    })));
  };

  const handleChangeDoc = (key: string, patch: Partial<DocFields>) => {
    setStepError(null);
    setPendingDocs((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  };

  const handleRemoveDoc = (key: string) => {
    setStepError(null);
    setPendingDocs((prev) => prev.filter((d) => d.key !== key));
  };

  /** Documents need a horse_id, so the queue is flushed only after creation.
   *  Returns the filenames that failed. */
  const uploadQueuedDocs = async (horseId: string): Promise<string[]> => {
    const failed: string[] = [];
    for (const doc of pendingDocs) {
      const fd = new FormData();
      fd.append('file', doc.file);
      fd.append('document_type', doc.document_type);
      fd.append('issue_date', doc.issue_date);
      fd.append('expiry_date', doc.expiry_date);
      // Claims the read taken before this horse existed, attaching horse_id and
      // recording which suggestions the uploader changed.
      if (doc.extraction) fd.append('extraction_id', doc.extraction.extraction_id);
      const res = await fetch(`/api/horses/${horseId}/documents`, { method: 'POST', body: fd });
      if (!res.ok) failed.push(doc.file.name);
    }
    return failed;
  };

  const handleCreate = async () => {
    // Re-check every step: the indicator lets the user jump back and change
    // an answer after a later step was already cleared.
    for (let i = 0; i < steps.length; i++) {
      const issue = stepIssue(steps[i].key);
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
    if (form.barn_name.trim()) body.barn_name = form.barn_name.trim();
    if (form.sex) body.sex = form.sex;
    if (form.sire_name.trim()) body.sire_name = form.sire_name.trim();
    if (form.dam_name.trim()) body.dam_name = form.dam_name.trim();
    if (form.foaling_date) body.foaling_date = form.foaling_date;
    if (form.color_id) body.color_id = form.color_id;
    if (form.pattern_id) body.pattern_id = form.pattern_id;

    const res = await fetch(`/api/exhibitors/${exhibitorId}/created-horses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to add horse.');
      setSaving(false);
      return;
    }

    const horse: CreatedHorseResult = await res.json();

    // Filed against an owner who is already on the platform: the record exists,
    // but it doesn't reach this profile until they say yes. Stop here rather
    // than handing the caller a horse the list won't show.
    if (horse.pending_owner_approval) {
      setSaving(false);
      setPendingApproval({
        horseName: horse.name,
        approverName: horse.approver_name ?? 'the owner',
        url: horse.approval_url ?? '',
        emailSent: horse.approval_email_sent ?? null,
      });
      return;
    }

    const failed = pendingDocs.length > 0 ? await uploadQueuedDocs(horse.id) : [];
    setSaving(false);

    // The horse exists from here on, so never route back to "Create Horse" —
    // point at the horse instead, or the exhibitor would create a duplicate.
    if (failed.length > 0) {
      setCreatedHorseId(horse.id);
      setError(
        `${horse.name} was created, but ${failed.length} document${failed.length === 1 ? '' : 's'} ` +
        `failed to upload (${failed.join(', ')}). Open the horse to add ${failed.length === 1 ? 'it' : 'them'}.`
      );
      return;
    }
    clearDraft(exhibitorId);
    onCreated(horse);
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
        <span className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>{step.label}</span>
        <span className="text-xs" style={{ color: 'var(--muted)' }}>Step {safeIndex + 1} of {steps.length}</span>
      </div>

      {/* Said, not silent. Somebody who half-added a horse a week ago and comes
          back to add a different one would otherwise find a form mysteriously
          pre-filled with the wrong animal — so the restore is announced and the
          way out of it is right there. Health documents are the exception and
          the note says so: an attached file cannot be kept, and a list restored
          with no bytes behind it would be a lie the upload discovers. */}
      {draftRestored && (
        <div
          className="rounded px-3 py-2 text-xs flex flex-wrap items-center gap-2"
          style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-hover)' }}
        >
          <span>
            Picked up where you left off. Any health documents you had attached need attaching
            again.
          </span>
          <button
            onClick={discardDraft}
            className="ml-auto font-medium hover:underline"
            style={{ color: 'var(--accent-hover)' }}
          >
            Start over
          </button>
        </div>
      )}

      {/* Step indicator — cleared steps stay reachable so answers can be revised. */}
      <ol className="flex flex-wrap gap-1.5">
        {steps.map((s, i) => {
          const active = i === safeIndex;
          const reachable = i <= Math.min(furthest, lastIndex);
          return (
            <li key={s.key}>
              <button
                onClick={() => reachable && goTo(i)}
                disabled={!reachable}
                title={reachable ? `Go to ${s.label}` : 'Finish the earlier steps first'}
                aria-current={active ? 'step' : undefined}
                className="px-2.5 py-1 rounded text-xs font-medium border disabled:opacity-50 disabled:cursor-not-allowed"
                style={active
                  ? { backgroundColor: 'var(--foreground)', color: 'var(--bg-subtle)', borderColor: 'var(--foreground)' }
                  : { backgroundColor: 'var(--surface)', color: 'var(--muted)', borderColor: 'var(--border)' }}
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
          <p className="text-xs font-medium" style={{ color: 'var(--foreground)' }}>Is this your horse? *</p>
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="ownerMode" checked={owner.mode === 'self'} onChange={() => handleOwnerMode('self')} className="h-4 w-4" />
              <span className="text-sm" style={{ color: 'var(--foreground)' }}>I own this horse</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="ownerMode" checked={owner.mode === 'ride'} onChange={() => handleOwnerMode('ride')} className="h-4 w-4" />
              <span className="text-sm" style={{ color: 'var(--foreground)' }}>I ride this horse, but do not own it</span>
            </label>
          </div>

          {owner.mode === 'ride' && !manualEntry && (
            <div className="space-y-3 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                Search for the horse and its owner first — if they&rsquo;re already in the app, adding them
                here keeps everyone on the same record.
              </p>
              <div className="flex flex-wrap gap-2 items-end">
                <div className="flex-1 min-w-[180px]">
                  <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>Horse name or registration #</label>
                  <input
                    value={rideQuery}
                    onChange={(e) => setRideQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRideSearch(); }}
                    placeholder="e.g. Fancy Little Gun"
                    className="w-full border rounded px-3 py-2 text-sm"
                    style={{ borderColor: 'var(--border)' }}
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

              {rideMessage && <p className="text-xs" style={{ color: 'var(--accent)' }}>{rideMessage}</p>}

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
                  style={{ color: 'var(--foreground)' }}
                >
                  Not in the app? Enter the owner details -&gt;
                </button>
              )}
            </div>
          )}

          {owner.mode === 'ride' && manualEntry && (
            <div className="space-y-2 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium" style={{ color: 'var(--foreground)' }}>Horse Owner *</p>
                <button onClick={() => { setManualEntry(false); setStepError(null); }} className="text-xs hover:underline" style={{ color: 'var(--muted)' }}>
                  &lt;- Back to search
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input placeholder="Owner first name *" value={owner.firstName} onChange={(e) => setOwner((p) => ({ ...p, firstName: e.target.value }))} className="border rounded px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }} />
                <input placeholder="Owner last name *" value={owner.lastName} onChange={(e) => setOwner((p) => ({ ...p, lastName: e.target.value }))} className="border rounded px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }} />
                <input type="email" placeholder="Owner email *" value={owner.email} onChange={(e) => setOwner((p) => ({ ...p, email: e.target.value }))} className="border rounded px-3 py-2 text-sm sm:col-span-2" style={{ borderColor: 'var(--border)' }} />
                <p className="text-xs sm:col-span-2" style={{ color: 'var(--muted)' }}>
                  If the owner already has an account, we&rsquo;ll ask them to confirm you ride
                  this horse, and it joins your list once they approve.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- Step 2: Horse (name required, rest optional) ---- */}
      {step.key === 'horse' && (
        <div className="space-y-3">
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Only the registered name is required — everything else can be added later from the horse&rsquo;s own page.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="col-span-full">
              <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>Registered name *</label>
              <input name="name" placeholder="Name on the association papers" maxLength={200} value={form.name} onChange={handleChange} className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }} />
              <p className="text-xs mt-1" style={{ color: 'var(--text-dimmed)' }}>
                This is what the horse is entered and published under.
              </p>
            </div>
            <div className="col-span-full">
              <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>Barn name</label>
              <input name="barn_name" placeholder="Stable or call name" maxLength={200} value={form.barn_name} onChange={handleChange} className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }} />
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>Sex</label>
              <select name="sex" value={form.sex} onChange={handleChange} className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
                <option value="">- Not specified -</option>
                <option value="Mare">Mare</option>
                <option value="Gelding">Gelding</option>
                <option value="Stallion">Stallion</option>
              </select>
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>Foaling Date</label>
              <input name="foaling_date" type="date" value={form.foaling_date} onChange={handleChange} className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }} />
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>Sire</label>
              <input name="sire_name" value={form.sire_name} onChange={handleChange} maxLength={200} placeholder="Registered name" className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }} />
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>Dam</label>
              <input name="dam_name" value={form.dam_name} onChange={handleChange} maxLength={200} placeholder="Registered name" className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }} />
            </div>
            <div className="col-span-full">
              <BreedCheckboxGroup breeds={breeds} selectedIds={form.breed_ids} onChange={(breed_ids) => setForm((prev) => ({ ...prev, breed_ids }))} />
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>Color</label>
              <select name="color_id" value={form.color_id} onChange={handleChange} className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
                <option value="">- Not specified -</option>
                {colors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>Pattern</label>
              <select name="pattern_id" value={form.pattern_id} onChange={handleChange} className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
                <option value="">- Not specified -</option>
                {patterns.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <p className="text-xs mt-1" style={{ color: 'var(--text-dimmed)' }}>
                A Paint has both — the papers say something like &ldquo;Bay Tobiano&rdquo;.
              </p>
            </div>
            <div className="flex items-center gap-2 col-span-full">
              <input type="checkbox" id="spb_new" checked={form.is_solid_paint_bred} onChange={(e) => setForm((prev) => ({ ...prev, is_solid_paint_bred: e.target.checked }))} className="h-4 w-4" />
              <label htmlFor="spb_new" className="text-sm" style={{ color: 'var(--muted)' }}>Solid Paint-Bred (SPB)</label>
            </div>
          </div>
        </div>
      )}

      {/* ---- Step 3: Trainer (optional) ---- */}
      {step.key === 'trainer' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium" style={{ color: 'var(--foreground)' }}>Trainer</p>
            <StepBadge>Optional</StepBadge>
          </div>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
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

      {/* ---- Health (optional, owner-only) ---- */}
      {step.key === 'health' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium" style={{ color: 'var(--foreground)' }}>Health Records</p>
            <StepBadge>Optional</StepBadge>
          </div>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Coggins, vaccination records, and health certificates. Choose a file and it is
            attached straight away; check its type and dates. These upload once the horse is
            created, so they stay listed here until you finish the wizard.
          </p>
          {/* Said outright rather than discovered at the upload. A record
              here is the document, not a note that one exists: the show office
              reads the expiry date off the file to work out whether a horse is
              covered for the weekend, and the desk checks the paper itself
              against the animal in the trailer. Dates with no scan behind them
              would clear a health flag on nobody's authority. */}
          <p
            className="text-xs rounded px-2 py-1.5"
            style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning-strong)' }}
          >
            A copy of the certificate is required — attach the scan or photo to add it to the
            horse&rsquo;s profile. Dates on their own cannot be filed here.
          </p>

          {pendingDocs.length > 0 && (
            <ul className="space-y-3">
              {pendingDocs.map((d) => (
                <AttachedDoc
                  key={d.key}
                  doc={d}
                  onChange={(patch) => handleChangeDoc(d.key, patch)}
                  onRemove={() => handleRemoveDoc(d.key)}
                />
              ))}
            </ul>
          )}

          <div>
            <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>File (PDF or image, max 10 MB)</label>
            <label
              className="flex flex-col items-center justify-center w-full rounded-lg border-2 border-dashed px-4 py-5 cursor-pointer transition-colors hover:bg-amber-50/40"
              style={{ borderColor: 'var(--border)' }}
            >
              <input
                type="file"
                accept=".pdf,image/*"
                onChange={(e) => {
                  handleAttachDoc(e.target.files?.[0] ?? null);
                  // Cleared so the next choice fires a change, even for the same
                  // file chosen again after removing it.
                  e.target.value = '';
                }}
                className="sr-only"
              />
              <span className="text-sm font-medium" style={{ color: 'var(--accent)' }}>
                {pendingDocs.length > 0 ? 'Click to attach another file' : 'Click to choose a file'}
              </span>
              <span className="text-xs mt-1" style={{ color: 'var(--text-dimmed)' }}>PDF or image - max 10 MB</span>
            </label>
          </div>

          {docError && <p className="text-red-600 text-xs">{docError}</p>}
        </div>
      )}

      {/* ---- Registrations (optional) ---- */}
      {step.key === 'registrations' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium" style={{ color: 'var(--foreground)' }}>Registrations &amp; Memberships</p>
            <StepBadge>Optional</StepBadge>
          </div>
          {(['breed', 'club'] as AssociationType[]).map((kind) => {
            const queued = pendingRegs.filter((r) => r.association_type === kind);
            const options = availableAssociations.filter((a) => a.association_type === kind);
            if (!queued.length && !options.length) return null;
            return (
              <div key={kind} className="space-y-2">
                <p className="text-xs font-medium pt-2" style={{ color: 'var(--foreground)' }}>
                  {kind === 'breed' ? 'Breed Registrations' : 'Club Memberships'}
                </p>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
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
                        style={{ borderColor: 'var(--border)' }}
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
                        style={{ borderColor: 'var(--border)' }}
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
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Check it over. Anything skipped can be filled in later from the horse&rsquo;s page.
          </p>
          <div className="rounded border divide-y px-3" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface)' }}>
            <ReviewRow label="Owner" value={ownerSummary} />
            <ReviewRow label="Registered Name" value={form.name.trim()} />
            <ReviewRow label="Barn Name" value={form.barn_name.trim()} skipped={!form.barn_name.trim()} />
            <ReviewRow label="Sex" value={form.sex} skipped={!form.sex} />
            <ReviewRow label="Foaling Date" value={form.foaling_date} skipped={!form.foaling_date} />
            <ReviewRow label="Sire" value={form.sire_name.trim()} skipped={!form.sire_name.trim()} />
            <ReviewRow label="Dam" value={form.dam_name.trim()} skipped={!form.dam_name.trim()} />
            <ReviewRow label="Breeds" value={breedLabel} skipped={!breedLabel} />
            <ReviewRow label="Color" value={colors.find((c) => c.id === form.color_id)?.name} skipped={!form.color_id} />
            <ReviewRow label="Pattern" value={patterns.find((p) => p.id === form.pattern_id)?.name} skipped={!form.pattern_id} />
            <ReviewRow label="SPB" value={form.is_solid_paint_bred ? 'Yes' : 'No'} />
            {owner.mode === 'self' && (
              <ReviewRow label="Trainer" value={trainerLabel} skipped={!trainerLabel} />
            )}
            {owner.mode === 'self' && (
              <ReviewRow
                label="Health Records"
                // Each one's type and expiry, not a count: Create Horse is the
                // save for what was read off these, so it is shown here to check.
                value={pendingDocs
                  .map((d) => `${DOC_TYPES.find((t) => t.value === d.document_type)?.label ?? d.file.name}, expires ${d.expiry_date}`)
                  .join('; ')}
                skipped={pendingDocs.length === 0}
              />
            )}
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

      {pendingApproval && (
        <div className="space-y-2">
          <p className="text-sm" style={{ color: 'var(--foreground)' }}>
            <strong>{pendingApproval.horseName}</strong> was added, and{' '}
            {pendingApproval.approverName} has been asked to confirm you ride it. It
            joins your horses once they approve.
          </p>
          <ApprovalLinkCallout
            url={pendingApproval.url}
            emailSent={pendingApproval.emailSent}
            approverName={pendingApproval.approverName}
          />
        </div>
      )}

      {/* Footer nav */}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex flex-wrap gap-2 pt-3">
          {pendingApproval ? null : createdHorseId ? (
            <Link
              href={`/profile/horses/${createdHorseId}?section=health`}
              className="px-4 py-2 rounded text-sm font-medium"
              style={PRIMARY_BUTTON}
            >
              Open {form.name.trim()}
            </Link>
          ) : (
            <>
              {safeIndex > 0 && (
                <button onClick={goBack} className="px-4 py-2 rounded text-sm border" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
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
                <button onClick={() => goTo(safeIndex + 1)} className="px-4 py-2 rounded text-sm border" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                  Skip
                </button>
              )}
            </>
          )}
        </div>
        <button onClick={() => { clearDraft(exhibitorId); onCancel(); }} className="ml-auto mt-3 text-xs hover:underline" style={{ color: 'var(--muted)' }}>
          {createdHorseId || pendingApproval ? returnLabel : 'Cancel'}
        </button>
      </div>
    </div>
  );
}
