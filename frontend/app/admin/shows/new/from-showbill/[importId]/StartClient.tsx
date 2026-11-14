'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api-error';
import { useRegisterUnsavedChanges } from '@/app/admin/shows/[id]/setup/_lib/StepAutosave';
import {
  readSummary,
  readerDoubts,
  startDefaults,
  startProblems,
  type ShowBillImport,
  type ShowCheckField,
  type StartForm,
} from '@/lib/showbill-import';

type ShowType = { id: string; code: string; name: string };

const POLL_MS = 4000;

const box = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)' } as const;
const input = 'w-full border rounded px-3 py-2 text-sm';
const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--foreground)' };

/**
 * Between a show bill's read and the show made from it (migration 187).
 *
 * It waits for the read, then asks for the four things a show row cannot exist
 * without — the name, the breed association, the first and last day — each
 * prefilled from the bill, with the reader's own doubt beside the box it is
 * about. Create makes the show as a DRAFT and opens Step 1. Everything else on
 * the bill is set up from the read, and each doubt about it is a check on its
 * setup step, highlighted on the field it is about. The show cannot leave DRAFT
 * until every one is answered.
 *
 * This replaced one long screen with the whole show on it. That screen was a
 * second copy of every setup step's form, and it lost everything typed into it
 * the moment somebody left the page.
 */
export default function StartClient({
  importId,
  showTypes,
}: {
  importId: string;
  showTypes: ShowType[];
}) {
  const router = useRouter();
  const [imp, setImp] = useState<ShowBillImport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<StartForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [conflictShowId, setConflictShowId] = useState<string | null>(null);

  const openShowTypeId = showTypes.find((t) => t.code === 'OPEN')?.id ?? null;

  // A correction typed here and not yet created is lost by leaving; ask first.
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
        <p style={{ color: 'var(--foreground)' }}>
          Reading <strong>{imp?.original_filename ?? 'the show bill'}</strong>…
        </p>
        <p style={{ color: 'var(--muted)' }}>
          A full show bill takes a few minutes. This page checks every few seconds, so you can leave
          it open, or come back from{' '}
          <Link href="/admin/shows/new/from-showbill" className="underline">
            the show bill page
          </Link>{' '}
          later.
        </p>
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

  async function create() {
    if (!form) return;
    setConflictShowId(null);
    const found = startProblems(form);
    setProblems(found);
    if (found.length) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/show-bill-imports/${importId}/create-show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, name: form.name.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.show_id) {
        // Step 1, not the hub: the walk through the steps is the review.
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
    } catch {
      setProblems(['The show could not be created.']);
    }
    setBusy(false);
  }

  return (
    <div className="space-y-5">
      {summary && (
        <section className="p-4 rounded-lg border text-sm space-y-2" style={box}>
          <h2 className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>
            What was read
          </h2>
          <ul className="list-disc pl-5 space-y-0.5" style={{ color: 'var(--foreground)' }}>
            <li>
              {summary.classes} class{summary.classes === 1 ? '' : 'es'}
              {summary.days > 1 ? ` over ${summary.days} days` : ''}, with their prices
            </li>
            <li>
              {summary.judges} judge{summary.judges === 1 ? '' : 's'}
              {summary.judges > 0 &&
                (summary.judgesMatched === summary.judges
                  ? ', all found in the judge registry'
                  : summary.judgesMatched > 0
                    ? `, ${summary.judgesMatched} found in the judge registry; the rest you add in Step 2`
                    : ', none in the judge registry yet; you add them in Step 2')}
            </li>
            {summary.clubs > 0 && (
              <li>
                {summary.clubs} sanctioning club{summary.clubs === 1 ? '' : 's'}
                {summary.clubsUnknown > 0 ? `, ${summary.clubsUnknown} not in the registry` : ''}
              </li>
            )}
            <li>
              {summary.fees} other fee{summary.fees === 1 ? '' : 's'}: stalls, shavings, camping and the
              show&apos;s own charges
            </li>
            {summary.venueNamed && (
              <li>
                The venue, {summary.venueMatched ? 'found on file' : 'not on file yet; you pick or add it in Step 1'}
              </li>
            )}
          </ul>
          <p style={{ color: 'var(--muted)' }}>
            Create makes the show as a draft and opens Step 1. Every step lists what to check on it,
            and highlights the field: what the reader was unsure of
            {summary.readerDoubts > 0 ? ` (${summary.readerDoubts} so far)` : ''}, and what the app
            couldn&apos;t match or wants a second look at. Accept each one, or change it. The show
            can&apos;t be published until they are all checked.
          </p>
        </section>
      )}

      {problems.length > 0 && (
        <Alert tone="error">
          <p className="font-medium">Fix these before creating the show:</p>
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

      <section className="p-4 rounded-lg border space-y-3" style={box}>
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>
            The show
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            A show can&apos;t be created without these four. Check them against the bill.
          </p>
        </div>
        <Field label="Show name *" doubts={readerDoubts(imp, 'name')}>
          <input className={input} style={inputStyle} value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field
          label={`Breed association *${breed ? ` (the bill says ${breed})` : ' (the bill names none)'}`}
          doubts={readerDoubts(imp, 'breed_association')}
        >
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
          {(['start_date', 'end_date'] as const).map((key: ShowCheckField & keyof StartForm) => (
            <Field key={key} label={key === 'start_date' ? 'First day *' : 'Last day *'} doubts={readerDoubts(imp, key)}>
              <input
                type="date"
                className={input}
                style={inputStyle}
                value={form[key] as string}
                onChange={(e) => set({ [key]: e.target.value })}
              />
            </Field>
          ))}
        </div>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Moving the first day moves the class schedule with it, day for day.
        </p>
        <label className="flex items-start gap-2 text-sm" style={{ color: 'var(--foreground)' }}>
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.attach_showbill}
            onChange={(e) => set({ attach_showbill: e.target.checked })}
          />
          <span>
            Keep {imp.original_filename} on file as the show&apos;s own show bill. The Show Bill button
            stays on the one the app generates until you switch it in the Show Bill step.
          </span>
        </label>
      </section>

      <div className="flex items-center justify-end gap-3 flex-wrap">
        <Link
          href="/admin/shows/new/from-showbill"
          className="text-sm rounded px-3 py-2 border"
          style={{ borderColor: 'var(--border)', color: 'var(--foreground)', backgroundColor: 'var(--surface)' }}
        >
          Cancel
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

function Field({ label, doubts, children }: { label: string; doubts: string[]; children: React.ReactNode }) {
  const flagged = doubts.length > 0;
  return (
    <label
      className={`block min-w-0 ${flagged ? 'rounded-md border-2 p-2' : ''}`}
      style={flagged ? { borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)' } : undefined}
    >
      <span className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>
        {label}
      </span>
      {children}
      {doubts.map((d) => (
        <span key={d} className="block text-xs mt-1" style={{ color: 'var(--warning-strong)' }}>
          The reader: {d}
        </span>
      ))}
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
