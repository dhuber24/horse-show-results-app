'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api-error';
import { useRegisterUnsavedChanges } from '@/app/admin/shows/[id]/setup/_lib/StepAutosave';
import {
  OFFICE_NOTES_MAX,
  PUBLIC_NOTES_MAX,
  billNamesVenue,
  newJudgeFromBill,
  newVenueFromBill,
  notesFile,
  readFilesLabel,
  readSourceNames,
  readSummary,
  searchJudges,
  searchVenues,
  startBody,
  startDefaults,
  startProblems,
  type DirectoryJudge,
  type DirectoryVenue,
  type JudgeChoice,
  type ShowBillImport,
  type StartForm,
  type VenueChoice,
} from '@/lib/showbill-import';
import CancelUploadButton from '../CancelUploadButton';

type ShowType = { id: string; code: string; name: string };
type Association = { id: string; code: string; name: string };

const POLL_MS = 4000;

const box = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)' } as const;
const input = 'w-full border rounded px-3 py-2 text-sm';
const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--foreground)' };
const muted = { color: 'var(--muted)' } as const;
const text = { color: 'var(--foreground)' } as const;
const smallButton = 'text-xs rounded px-2.5 py-1 border';
const smallButtonStyle = { borderColor: 'var(--border)', color: 'var(--foreground)', backgroundColor: 'var(--surface)' };
const unsettledStyle = { borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)' };

/**
 * Between a show bill's read and the show made from it.
 *
 * It waits for the read, then asks for what a read cannot settle on its own:
 * the four things a show row cannot exist without (prefilled from the bill),
 * who each judge the bill names is and which venue it is held at — found in
 * the directory, or added with an email or phone (a judge) or a full address
 * (a venue) — and the two notes drafted from the bill: the show notes
 * exhibitors read and the office notes that list what to look over. Create
 * makes the show as a DRAFT, filled in as far as the bill allows, and opens
 * Step 1. Nothing afterwards waits on an Accept.
 */
export default function StartClient({
  importId,
  showTypes,
  judgeDirectory,
  venueDirectory,
  associations,
  canAddVenue,
}: {
  importId: string;
  showTypes: ShowType[];
  judgeDirectory: DirectoryJudge[];
  venueDirectory: DirectoryVenue[];
  associations: Association[];
  canAddVenue: boolean;
}) {
  const router = useRouter();
  const [imp, setImp] = useState<ShowBillImport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<StartForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [conflictShowId, setConflictShowId] = useState<string | null>(null);
  // A judge saved from this page joins the directory at once, so the row that
  // added them reads as picked and every other row can find them.
  const [directory, setDirectory] = useState<DirectoryJudge[]>(judgeDirectory);

  const openShowTypeId = showTypes.find((t) => t.code === 'OPEN')?.id ?? null;

  // Anything settled here and not yet created is lost by leaving; ask first.
  useRegisterUnsavedChanges(
    () =>
      !busy &&
      form !== null &&
      imp !== null &&
      JSON.stringify(form) !== JSON.stringify(startDefaults(imp, openShowTypeId)),
  );

  // Poll while the read runs; stop the moment it has an answer.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const res = await fetch(`/api/show-bill-imports/${importId}`, { cache: 'no-store' });
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(errorMessage(body, 'This show bill could not be loaded.'));
          return;
        }
        setImp(body);
        if (body.status === 'pending') timer = setTimeout(load, POLL_MS);
      } catch {
        if (!cancelled) timer = setTimeout(load, POLL_MS * 2);
      }
    }
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [importId]);

  useEffect(() => {
    if (imp?.status === 'succeeded' && imp.extracted && !imp.show_id && !form) {
      setForm(startDefaults(imp, openShowTypeId));
    }
  }, [imp, form, openShowTypeId]);

  if (loadError) return <Alert tone="error">{loadError}</Alert>;
  if (!imp || imp.status === 'pending') {
    return (
      <section className="p-6 rounded-lg border text-sm space-y-2" style={box}>
        <p style={text}>
          Reading <strong>{imp?.original_filename ?? 'the show bill'}</strong>
          {imp?.supporting_filenames?.length ? (
            <>
              {' '}with <strong>{imp.supporting_filenames.join(', ')}</strong>
            </>
          ) : null}
          …
        </p>
        <p style={muted}>
          A full show bill takes a few minutes. This page checks every few seconds, so you can leave
          it open, or come back from{' '}
          <Link href="/admin/shows/new/from-showbill" className="underline">
            the show bill page
          </Link>{' '}
          later.
        </p>
        {imp && (
          <p className="flex items-center gap-2 flex-wrap">
            <CancelUploadButton
              importId={imp.id}
              label={readFilesLabel(imp)}
              onCancelled={() => router.push('/admin/shows/new/from-showbill')}
            />
          </p>
        )}
      </section>
    );
  }
  if (imp.show_id) {
    return (
      <Alert tone="info">
        A show has already been created from this show bill.{' '}
        <Link href={`/admin/shows/${imp.show_id}/setup`} className="underline">
          Open its setup →
        </Link>
      </Alert>
    );
  }
  if (imp.status !== 'succeeded') {
    return (
      <div className="space-y-3">
        <Alert tone="error">{imp.message ?? 'The show bill could not be read.'}</Alert>
        <p className="text-sm">
          <Link href="/admin/shows/new/from-showbill" className="underline" style={{ color: 'var(--primary)' }}>
            Upload it again
          </Link>{' '}
          or{' '}
          <Link href="/admin/shows/new" className="underline" style={{ color: 'var(--primary)' }}>
            set the show up step by step
          </Link>
          .
        </p>
      </div>
    );
  }
  if (!form) return null;

  const summary = readSummary(imp);
  const breed = imp.extracted?.show.breed_association;
  const set = (patch: Partial<StartForm>) => setForm({ ...form, ...patch });
  const setJudge = (i: number, choice: JudgeChoice) =>
    setForm({ ...form, judges: form.judges.map((c, n) => (n === i ? choice : c)) });

  function download() {
    if (!form || !imp) return;
    const blob = new Blob([notesFile(form, readSourceNames(imp))], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(form.name.trim() || 'show').replace(/[^\w.-]+/g, '-')}-notes.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function create() {
    if (!form || !imp) return;
    setConflictShowId(null);
    const found = startProblems(form, imp, canAddVenue);
    setProblems(found);
    if (found.length) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/show-bill-imports/${importId}/create-show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(startBody(form)),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.show_id) {
        // Step 1, where the office notes are: the walk through the steps is the review.
        router.push(`/admin/shows/${body.show_id}/edit`);
        return;
      }
      const detail = body?.detail;
      if (res.status === 409 && detail?.show_id) setConflictShowId(detail.show_id);
      setProblems(
        Array.isArray(detail?.problems) && detail.problems.length
          ? detail.problems
          : [errorMessage(body, 'The show could not be created.')],
      );
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      setProblems(['The show could not be created.']);
    }
    setBusy(false);
  }

  const billJudges = imp.extracted?.judges ?? [];

  return (
    <div className="space-y-5">
      {problems.length > 0 && (
        <Alert tone="error">
          <p className="font-medium">Before the show can be created:</p>
          <ul className="list-disc pl-5 mt-1 space-y-0.5">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {conflictShowId && (
            <Link href={`/admin/shows/${conflictShowId}/setup`} className="underline">
              Open the show that was created →
            </Link>
          )}
        </Alert>
      )}

      {summary && (
        <section className="p-4 rounded-lg border text-sm space-y-2" style={box}>
          <h2 className="text-base font-semibold" style={text}>
            What Create will set up
          </h2>
          <ul className="list-disc pl-5 space-y-0.5" style={text}>
            <li>
              {summary.classes} class{summary.classes === 1 ? '' : 'es'}
              {summary.days > 1 ? ` over ${summary.days} days` : ''}, with their prices
            </li>
            {summary.clubs > 0 && (
              <li>
                {summary.clubs} sanctioning club{summary.clubs === 1 ? '' : 's'}
                {summary.clubsUnknown > 0 ? `, ${summary.clubsUnknown} not in the registry yet` : ''}
              </li>
            )}
            <li>
              {summary.fees} other fee{summary.fees === 1 ? '' : 's'}: stalls, shavings, camping and the
              show&apos;s own charges
            </li>
            {summary.futurities > 0 && (
              <li>
                {summary.futurities} futurit{summary.futurities === 1 ? 'y' : 'ies'}, with the classes the bill
                marks for {summary.futurities === 1 ? 'it' : 'them'}
              </li>
            )}
            {summary.sidePots > 0 && (
              <li>
                {summary.sidePots} side pot{summary.sidePots === 1 ? '' : 's'} or jackpot
                {summary.sidePots === 1 ? '' : 's'}
              </li>
            )}
            {summary.stallPeriods.length > 0 && (
              <li>
                {summary.stallPeriods.length === 1
                  ? `A ${summary.stallPeriods[0]} stall period`
                  : `${summary.stallPeriods.length} stall periods (${summary.stallPeriods.join(', ')})`}{' '}
                on Lodging, with their stall prices, move-in days and notes
              </li>
            )}
            {summary.vaccinationNotes && <li>The vaccinations the bill requires, on Paperwork</li>}
            <li>The judges and venue you settle below, and the two notes at the bottom</li>
          </ul>
          <p style={muted}>
            The show starts as a draft. Anything worth a second look waits on the setup step it is
            about, to change there and confirm.
          </p>
        </section>
      )}

      <section className="p-4 rounded-lg border space-y-3" style={box}>
        <div>
          <h2 className="text-base font-semibold" style={text}>
            The show
          </h2>
          <p className="text-xs mt-0.5" style={muted}>
            A show can&apos;t be created without these four. Check them against the bill.
          </p>
        </div>
        <Field label="Show name *">
          <input className={input} style={inputStyle} value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label={`Breed association *${breed ? ` (the bill says ${breed})` : ' (the bill names none)'}`}>
          <select
            className={input}
            style={inputStyle}
            value={form.show_type_id}
            onChange={(e) => set({ show_type_id: e.target.value })}
          >
            <option value="">Select…</option>
            {showTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.code} — {t.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="First day *">
            <input
              type="date"
              className={input}
              style={inputStyle}
              value={form.start_date}
              onChange={(e) => set({ start_date: e.target.value })}
            />
          </Field>
          <Field label="Last day *">
            <input
              type="date"
              className={input}
              style={inputStyle}
              value={form.end_date}
              onChange={(e) => set({ end_date: e.target.value })}
            />
          </Field>
        </div>
        <p className="text-xs" style={muted}>
          Moving the first day moves the class schedule with it, day for day.
        </p>
        <label className="flex items-start gap-2 text-sm" style={text}>
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.attach_showbill}
            onChange={(e) => set({ attach_showbill: e.target.checked })}
          />
          <span>
            Keep your paper Show Bill attached to this show so that it can be downloaded and/or viewed
            by exhibitors and spectators
          </span>
        </label>
      </section>

      {billJudges.length > 0 && (
        <section className="p-4 rounded-lg border space-y-3" style={box}>
          <div>
            <h2 className="text-base font-semibold" style={text}>
              Judges
            </h2>
            <p className="text-xs mt-0.5" style={muted}>
              A judge is attached on their own only when exactly one person of that name is in the
              directory. Find anyone else there; if they aren&apos;t in it, add them with an email or a
              phone, which is how the directory tells two people of one name apart.
            </p>
          </div>
          <ul className="space-y-3">
            {billJudges.map((j, i) => (
              <JudgeRow
                key={i}
                printed={`${j.first_name} ${j.last_name}`}
                cards={j.associations}
                choice={form.judges[i]}
                onChange={(c) => setJudge(i, c)}
                directory={directory}
                candidateIds={imp.resolved?.judges[i]?.candidate_judge_ids ?? []}
                fromBill={() => newJudgeFromBill(imp, i)}
                associations={associations}
                onSaved={(judge) => {
                  // Functional: the save is a round trip, and anything typed
                  // meanwhile must not be overwritten by this render's form.
                  setDirectory((d) => [...d, judge]);
                  setForm((f) =>
                    f ? { ...f, judges: f.judges.map((c, n) => (n === i ? { kind: 'directory', judge_id: judge.id } : c)) } : f,
                  );
                }}
              />
            ))}
          </ul>
        </section>
      )}

      {billNamesVenue(imp) && (
        <VenueBox
          printed={[imp.extracted?.show.venue_name, imp.extracted?.show.venue_city, imp.extracted?.show.venue_state]
            .filter(Boolean)
            .join(', ')}
          choice={form.venue}
          onChange={(venue) => set({ venue })}
          directory={venueDirectory}
          fromBill={() => newVenueFromBill(imp)}
          canAdd={canAddVenue}
        />
      )}

      <section className="p-4 rounded-lg border space-y-4" style={box}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-base font-semibold" style={text}>
              Notes from the show bill
            </h2>
            <p className="text-xs mt-0.5" style={muted}>
              Drafted from the bill. Edit them, clear what you don&apos;t want, or download a copy: what is
              left here is saved with the show, and both can be changed later on Step 1.
            </p>
          </div>
          <button type="button" onClick={download} className={smallButton} style={smallButtonStyle}>
            Download notes
          </button>
        </div>
        <NotesField
          label="Show notes — exhibitors see these on the show page and the show bill"
          value={form.public_notes}
          max={PUBLIC_NOTES_MAX}
          rows={5}
          onChange={(public_notes) => set({ public_notes })}
          empty="The bill says nothing for exhibitors that another field doesn't already hold."
        />
        <NotesField
          label="Office notes — only the show office sees these: what the bill tells the office, such as its officials and their contacts"
          value={form.office_notes}
          max={OFFICE_NOTES_MAX}
          rows={12}
          onChange={(office_notes) => set({ office_notes })}
          empty="The bill tells the office nothing that another field doesn't already hold."
        />
      </section>

      {/* "Back" leaves the upload ready to create, listed on the show bill page
          and above the shows; "Cancel upload" deletes it. A link labelled
          Cancel that did the first was read as the second. */}
      <div className="flex items-center justify-end gap-3 flex-wrap">
        <CancelUploadButton
          importId={imp.id}
          label={readFilesLabel(imp)}
          variant="button"
          onCancelled={() => router.push('/admin/shows/new/from-showbill')}
        />
        <Link
          href="/admin/shows/new/from-showbill"
          className="text-sm rounded px-3 py-2 border"
          style={{ borderColor: 'var(--border)', color: 'var(--foreground)', backgroundColor: 'var(--surface)' }}
        >
          Back to uploads
        </Link>
        <button
          type="button"
          onClick={create}
          disabled={busy}
          className="text-sm rounded px-4 py-2 disabled:opacity-50"
          style={{ backgroundColor: 'var(--text-deep)', color: 'var(--surface)' }}
        >
          {busy ? 'Creating…' : 'Create draft show and start setup →'}
        </button>
      </div>
    </div>
  );
}

// ── One judge the bill names ────────────────────────────────────────────────

function JudgeRow({
  printed,
  cards,
  choice,
  onChange,
  directory,
  candidateIds,
  fromBill,
  associations,
  onSaved,
}: {
  printed: string;
  cards: string[];
  choice: JudgeChoice;
  onChange: (c: JudgeChoice) => void;
  directory: DirectoryJudge[];
  candidateIds: string[];
  fromBill: () => Omit<Extract<JudgeChoice, { kind: 'new' }>, 'kind'>;
  associations: Association[];
  onSaved: (judge: DirectoryJudge) => void;
}) {
  const [query, setQuery] = useState('');
  const picked = choice.kind === 'directory' ? directory.find((j) => j.id === choice.judge_id) : null;
  const results = searchJudges(directory, query, candidateIds);
  const unsettled = choice.kind === 'unsettled';

  return (
    <li className="rounded-md border p-3 space-y-2 text-sm" style={unsettled ? unsettledStyle : { borderColor: 'var(--border)' }}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <p style={text}>
          <span className="font-medium">{printed}</span>
          {cards.length > 0 && <span style={muted}> · the bill: {cards.join('/')}</span>}
        </p>
        {!unsettled && (
          <button type="button" className={smallButton} style={smallButtonStyle} onClick={() => onChange({ kind: 'unsettled' })}>
            Change
          </button>
        )}
      </div>

      {choice.kind === 'directory' && (
        <p style={text}>
          ✓ {picked ? <JudgeName judge={picked} /> : 'A judge in the directory'}
        </p>
      )}
      {choice.kind === 'leave_off' && <p style={muted}>Left off this show.</p>}
      {choice.kind === 'new' && (
        <NewJudgeForm value={choice} onChange={onChange} associations={associations} onSaved={onSaved} />
      )}

      {unsettled && (
        <div className="space-y-2">
          <input
            className={input}
            style={inputStyle}
            placeholder="Search the judge directory by name, email or phone"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {results.length > 0 ? (
            <ul className="space-y-1">
              {query.trim() === '' && (
                <li className="text-xs" style={muted}>
                  In the directory with that last name:
                </li>
              )}
              {results.map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-2">
                  <JudgeName judge={j} />
                  <button
                    type="button"
                    className={smallButton}
                    style={smallButtonStyle}
                    onClick={() => onChange({ kind: 'directory', judge_id: j.id })}
                  >
                    This is them
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            query.trim() !== '' && (
              <p className="text-xs" style={muted}>
                Nobody in the directory matches “{query.trim()}”.
              </p>
            )
          )}
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              className={smallButton}
              style={smallButtonStyle}
              onClick={() => onChange({ kind: 'new', ...fromBill() })}
            >
              Not in the directory: add them
            </button>
            <button type="button" className={smallButton} style={smallButtonStyle} onClick={() => onChange({ kind: 'leave_off' })}>
              Not judging this show: leave them off
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function JudgeName({ judge }: { judge: DirectoryJudge }) {
  const contact = [judge.email, judge.phone].filter(Boolean).join(' · ');
  const judgeCards = judge.associations.map((a) => a.code).join('/');
  return (
    <span style={text}>
      {judge.first_name} {judge.last_name}
      {(contact || judgeCards) && <span style={muted}> · {[judgeCards, contact].filter(Boolean).join(' · ')}</span>}
    </span>
  );
}

/**
 * A judge the directory does not have yet. Save adds them to it there and
 * then, and the row reads as picked; a form left unsaved is still added when
 * the show is created, so Save is a way to settle a judge now, not a gate.
 */
function NewJudgeForm({
  value,
  onChange,
  associations,
  onSaved,
}: {
  value: Extract<JudgeChoice, { kind: 'new' }>;
  onChange: (c: JudgeChoice) => void;
  associations: Association[];
  onSaved: (judge: DirectoryJudge) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const set = (patch: Partial<typeof value>) => {
    setSaveError(null);
    onChange({ ...value, ...patch });
  };
  const missing = !value.first_name.trim() || !value.last_name.trim()
    ? 'A first and last name are required.'
    : !value.email.trim() && !value.phone.trim()
      ? 'Add an email or a phone.'
      : null;

  async function save() {
    if (missing) {
      setSaveError(missing);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/judges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: value.first_name.trim(),
          last_name: value.last_name.trim(),
          email: value.email.trim() || null,
          phone: value.phone.trim() || null,
          association_ids: value.association_ids,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.id) {
        setSaveError(errorMessage(body, 'The judge could not be saved.'));
        return;
      }
      onSaved({
        id: body.id,
        first_name: body.first_name,
        last_name: body.last_name,
        email: body.email ?? null,
        phone: body.phone ?? null,
        associations: (body.associations ?? []).map((a: { id: string; code: string }) => ({ id: a.id, code: a.code })),
      });
    } catch {
      setSaveError('The judge could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs" style={muted}>
        A new judge in the directory. An email or a phone is required.
      </p>
      <div className="grid sm:grid-cols-2 gap-2">
        <Field label="First name *">
          <input className={input} style={inputStyle} value={value.first_name} onChange={(e) => set({ first_name: e.target.value })} />
        </Field>
        <Field label="Last name *">
          <input className={input} style={inputStyle} value={value.last_name} onChange={(e) => set({ last_name: e.target.value })} />
        </Field>
        <Field label="Email">
          <input type="email" className={input} style={inputStyle} value={value.email} onChange={(e) => set({ email: e.target.value })} />
        </Field>
        <Field label="Phone">
          <input type="tel" className={input} style={inputStyle} value={value.phone} onChange={(e) => set({ phone: e.target.value })} />
        </Field>
      </div>
      {associations.length > 0 && (
        <fieldset className="text-xs space-y-1">
          <legend style={muted}>Carded with</legend>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {associations.map((a) => (
              <label key={a.id} className="flex items-center gap-1" style={text} title={a.name}>
                <input
                  type="checkbox"
                  checked={value.association_ids.includes(a.id)}
                  onChange={(e) =>
                    set({
                      association_ids: e.target.checked
                        ? [...value.association_ids, a.id]
                        : value.association_ids.filter((id) => id !== a.id),
                    })
                  }
                />
                {a.code}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="text-sm rounded px-3 py-1.5 disabled:opacity-50"
          style={{ backgroundColor: 'var(--text-deep)', color: 'var(--surface)' }}
        >
          {saving ? 'Saving…' : 'Save judge'}
        </button>
        {saveError && (
          <span className="text-xs" role="alert" style={{ color: 'var(--error-strong)' }}>
            {saveError}
          </span>
        )}
      </div>
    </div>
  );
}

// ── The venue the bill names ────────────────────────────────────────────────

function VenueBox({
  printed,
  choice,
  onChange,
  directory,
  fromBill,
  canAdd,
}: {
  printed: string;
  choice: VenueChoice;
  onChange: (c: VenueChoice) => void;
  directory: DirectoryVenue[];
  fromBill: () => Omit<Extract<VenueChoice, { kind: 'new' }>, 'kind'>;
  canAdd: boolean;
}) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const picked = choice.kind === 'directory' ? directory.find((v) => v.id === choice.venue_id) : null;
  const open = choice.kind === 'none' || searching;
  const results = searchVenues(directory, query);

  return (
    <section className="p-4 rounded-lg border space-y-3 text-sm" style={open && canAdd ? { ...box, ...unsettledStyle } : box}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-base font-semibold" style={text}>
            Venue
          </h2>
          <p className="text-xs mt-0.5" style={muted}>
            The bill says: {printed}
          </p>
        </div>
        {!open && (
          <button type="button" className={smallButton} style={smallButtonStyle} onClick={() => setSearching(true)}>
            Change
          </button>
        )}
      </div>

      {!open && choice.kind === 'directory' && (
        <p style={text}>✓ {picked ? <VenueName venue={picked} /> : 'A venue in the directory'}</p>
      )}
      {choice.kind === 'new' && !searching && (
        <NewVenueForm value={choice} onChange={onChange} />
      )}

      {open && (
        <div className="space-y-2">
          <input
            className={input}
            style={inputStyle}
            placeholder="Search the venue directory by name, street or city"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {results.length > 0 ? (
            <ul className="space-y-1">
              {results.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2">
                  <VenueName venue={v} />
                  <button
                    type="button"
                    className={smallButton}
                    style={smallButtonStyle}
                    onClick={() => {
                      setSearching(false);
                      onChange({ kind: 'directory', venue_id: v.id });
                    }}
                  >
                    This is it
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            query.trim() !== '' && (
              <p className="text-xs" style={muted}>
                No venue in the directory matches “{query.trim()}”.
              </p>
            )
          )}
          <div className="flex gap-2 flex-wrap">
            {canAdd ? (
              <button
                type="button"
                className={smallButton}
                style={smallButtonStyle}
                onClick={() => {
                  setSearching(false);
                  onChange({ kind: 'new', ...fromBill() });
                }}
              >
                Not in the directory: add it
              </button>
            ) : (
              <p className="text-xs" style={muted}>
                Not in the directory? Only a show manager can add a venue: leave it blank and ask one to add it on
                Step 1.
              </p>
            )}
            {searching && (
              <button type="button" className={smallButton} style={smallButtonStyle} onClick={() => setSearching(false)}>
                Keep {choice.kind === 'new' ? 'the new venue' : choice.kind === 'directory' ? 'the venue picked' : 'it blank'}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function VenueName({ venue }: { venue: DirectoryVenue }) {
  const where = [venue.address, venue.city, venue.state].filter(Boolean).join(', ');
  return (
    <span style={text}>
      {venue.name}
      {where && <span style={muted}> · {where}</span>}
    </span>
  );
}

function NewVenueForm({
  value,
  onChange,
}: {
  value: Extract<VenueChoice, { kind: 'new' }>;
  onChange: (c: VenueChoice) => void;
}) {
  const set = (patch: Partial<typeof value>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-2">
      <p className="text-xs" style={muted}>
        A new venue in the directory, with its full address.
      </p>
      <Field label="Name *">
        <input className={input} style={inputStyle} value={value.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <Field label="Street address *">
        <input className={input} style={inputStyle} value={value.address} onChange={(e) => set({ address: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="col-span-2">
          <Field label="City *">
            <input className={input} style={inputStyle} value={value.city} onChange={(e) => set({ city: e.target.value })} />
          </Field>
        </div>
        <Field label="State *">
          <input className={input} style={inputStyle} value={value.state} onChange={(e) => set({ state: e.target.value })} />
        </Field>
        <Field label="ZIP *">
          <input className={input} style={inputStyle} value={value.zip} onChange={(e) => set({ zip: e.target.value })} />
        </Field>
      </div>
    </div>
  );
}

// ── Bits ────────────────────────────────────────────────────────────────────

function NotesField({
  label,
  value,
  max,
  rows,
  onChange,
  empty,
}: {
  label: string;
  value: string;
  max: number;
  rows: number;
  onChange: (v: string) => void;
  empty: string;
}) {
  const over = value.length > max;
  return (
    <div className="space-y-1">
      <div className="flex items-end justify-between gap-2">
        <span className="text-xs" style={muted}>
          {label}
        </span>
        {value && (
          <button type="button" className={smallButton} style={smallButtonStyle} onClick={() => onChange('')}>
            Clear
          </button>
        )}
      </div>
      <textarea
        className={`${input} font-mono text-xs`}
        style={inputStyle}
        rows={rows}
        value={value}
        placeholder={empty}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      />
      <p className="text-xs text-right" style={over ? { color: 'var(--error-strong)' } : muted}>
        {value.length.toLocaleString()} / {max.toLocaleString()}
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="block text-xs mb-1" style={muted}>
        {label}
      </span>
      {children}
    </label>
  );
}

function Alert({ tone, children }: { tone: 'error' | 'info'; children: React.ReactNode }) {
  const style =
    tone === 'error'
      ? { borderColor: 'var(--error)', backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }
      : { borderColor: 'var(--accent-border)', backgroundColor: 'var(--accent-bg)', color: 'var(--foreground)' };
  return (
    <div className="rounded border px-3 py-2 text-sm" style={style} role={tone === 'error' ? 'alert' : undefined}>
      {children}
    </div>
  );
}
