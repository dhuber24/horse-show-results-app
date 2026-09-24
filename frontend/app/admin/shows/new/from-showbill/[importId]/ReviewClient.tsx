'use client';

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api-error';
import {
  AUTOMATIC_FEE_UNITS,
  CLUB_SANCTION_UNITS,
  RESERVABLE_FEE_UNITS,
  canHaveEarlyRate,
  canHaveMinimumQuantity,
  isAutomaticUnit,
  isReservableUnit,
  judgesLabel,
  unitLabel,
  type ClubSanctionUnit,
  type FeeUnit,
} from '@/lib/fee-units';
import {
  buildApplyPayload,
  centsFromDollars,
  classCents,
  dollarsFromCents,
  duplicateClassKeys,
  initialDraft,
  mapClub,
  panelForCount,
  rateCents,
  rateJudgeCount,
  type Association,
  type Draft,
  type DraftClass,
  type DraftClub,
  type DraftFee,
  type DraftJudge,
  type RegistryJudge,
  type ShowBillImport,
} from '@/lib/showbill-import';

type ShowType = { id: string; code: string; name: string };
type Venue = { id: string; name: string; city: string | null; state: string | null };

const POLL_MS = 4000;

const FEE_UNIT_OPTIONS: FeeUnit[] = [...RESERVABLE_FEE_UNITS, ...AUTOMATIC_FEE_UNITS, 'flat'];

const box = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)' } as const;
const input = 'w-full border rounded px-2 py-1.5 text-sm';
const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--foreground)' };

/** What a fee's unit means for who pays — the three families `billing.py` bills by. */
function feeFamily(unit: string): { text: string; tone: 'muted' | 'warn' } {
  if (isReservableUnit(unit)) return { text: 'Booked by the exhibitor at sign-up.', tone: 'muted' };
  if (unit === 'per_entry') {
    return {
      text: "Added to every class entered, on top of the class's own price. A class price belongs under Class prices, not here.",
      tone: 'warn',
    };
  }
  if (isAutomaticUnit(unit)) return { text: 'Charged to every exhibitor who enters a class.', tone: 'warn' };
  return { text: 'Printed on the show bill. Bills nobody automatically.', tone: 'muted' };
}

function formatDay(iso: string): string {
  if (!iso) return 'No day';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function shortDay(iso: string): string {
  if (!iso) return '—';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export default function ReviewClient({
  importId,
  callerRole,
  showTypes,
  venues,
  associations,
  registryJudges,
}: {
  importId: string;
  callerRole: string;
  showTypes: ShowType[];
  venues: Venue[];
  associations: Association[];
  registryJudges: RegistryJudge[];
}) {
  const router = useRouter();
  const [imp, setImp] = useState<ShowBillImport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [conflictShowId, setConflictShowId] = useState<string | null>(null);

  const canCreateVenue = callerRole === 'ADMIN' || callerRole === 'SHOW_MANAGER';
  const openShowTypeId = showTypes.find((t) => t.code === 'OPEN')?.id ?? null;

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
    if (imp?.status === 'succeeded' && imp.extracted && imp.resolved && !imp.show_id && !draft) {
      setDraft(initialDraft(imp, { canCreateVenue, openShowTypeId }));
    }
  }, [imp, draft, canCreateVenue, openShowTypeId]);

  const clubs = useMemo(() => associations.filter((a) => a.association_type === 'club'), [associations]);

  const panel = useMemo(
    () => (draft ? panelForCount(draft.judges, registryJudges, associations) : []),
    [draft, registryJudges, associations],
  );

  const rateTotals = useMemo(() => {
    const totals = new Map<string, number | null>();
    for (const rate of draft?.rates ?? []) {
      totals.set(rate.key, rateCents(rate, rateJudgeCount(rate, panel, associations).count));
    }
    return totals;
  }, [draft?.rates, panel, associations]);

  // Stable across keystrokes in the class table, so the memoised rows only
  // re-render when something they show has changed.
  const clubColumns = useMemo(
    () =>
      (draft?.clubs ?? [])
        .filter((c) => c.include && c.association_id)
        .map((c) => ({
          id: c.association_id,
          code: associations.find((a) => a.id === c.association_id)?.code ?? c.code,
        })),
    [draft?.clubs, associations],
  );
  const daysKey = Array.from(new Set((draft?.classes ?? []).map((c) => c.class_date)))
    .sort()
    .join('|');
  const days = useMemo(() => (daysKey ? daysKey.split('|') : []), [daysKey]);

  const updateClass = useCallback((key: string, patch: Partial<DraftClass>) => {
    setDraft((d) => (d ? { ...d, classes: d.classes.map((c) => (c.key === key ? { ...c, ...patch } : c)) } : d));
  }, []);
  const updateJudge = (key: string, patch: Partial<DraftJudge>) =>
    setDraft((d) => (d ? { ...d, judges: d.judges.map((j) => (j.key === key ? { ...j, ...patch } : j)) } : d));
  const updateClub = (key: string, patch: Partial<DraftClub>) =>
    setDraft((d) => (d ? { ...d, clubs: d.clubs.map((c) => (c.key === key ? { ...c, ...patch } : c)) } : d));
  const updateFee = (key: string, patch: Partial<DraftFee>) =>
    setDraft((d) => (d ? { ...d, fees: d.fees.map((f) => (f.key === key ? { ...f, ...patch } : f)) } : d));

  if (loadError) {
    return <Alert tone="error">{loadError}</Alert>;
  }
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
          Open it →
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
  if (!draft) return null;

  const x = imp.extracted!;
  const dupes = duplicateClassKeys(draft.classes);

  async function create() {
    if (!draft) return;
    setProblems([]);
    setConflictShowId(null);
    const built = buildApplyPayload(draft, rateTotals);
    if (!built.payload) {
      setProblems(built.errors);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/show-bill-imports/${importId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(built.payload),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.show_id) {
        router.push(`/admin/shows/${body.show_id}/setup`);
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

  return (
    <div className="space-y-6">
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

      {(x.warnings.length > 0 || x.not_imported.length > 0) && (
        <section className="p-4 rounded-lg border space-y-3 text-sm" style={{ borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)' }}>
          {x.warnings.length > 0 && (
            <div>
              <p className="font-medium" style={{ color: 'var(--foreground)' }}>Worth a second look</p>
              <ul className="list-disc pl-5 mt-1 space-y-0.5" style={{ color: 'var(--foreground)' }}>
                {x.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {x.not_imported.length > 0 && (
            <div>
              <p className="font-medium" style={{ color: 'var(--foreground)' }}>
                On the bill, but set up in the setup steps rather than here
              </p>
              <ul className="list-disc pl-5 mt-1 space-y-0.5" style={{ color: 'var(--foreground)' }}>
                {x.not_imported.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* ── Show details ── */}
      <Section title="Show details">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Show name *">
            <input
              className={input}
              style={inputStyle}
              value={draft.show.name}
              onChange={(e) => setDraft({ ...draft, show: { ...draft.show, name: e.target.value } })}
            />
          </Field>
          <Field label={`Breed association *${x.show.breed_association ? ` (the bill says ${x.show.breed_association})` : ''}`}>
            <select
              className={input}
              style={inputStyle}
              value={draft.show.show_type_id}
              onChange={(e) => setDraft({ ...draft, show: { ...draft.show, show_type_id: e.target.value } })}
            >
              <option value="">Select…</option>
              {showTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code} — {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Start date *">
            <input
              type="date"
              className={input}
              style={inputStyle}
              value={draft.show.start_date}
              onChange={(e) => setDraft({ ...draft, show: { ...draft.show, start_date: e.target.value } })}
            />
          </Field>
          <Field label="End date *">
            <input
              type="date"
              className={input}
              style={inputStyle}
              value={draft.show.end_date}
              onChange={(e) => setDraft({ ...draft, show: { ...draft.show, end_date: e.target.value } })}
            />
          </Field>
          <Field label="Entries close">
            <input
              type="date"
              className={input}
              style={inputStyle}
              value={draft.show.entry_deadline}
              onChange={(e) => setDraft({ ...draft, show: { ...draft.show, entry_deadline: e.target.value } })}
            />
          </Field>
          <Field label="APHA zone">
            <input
              inputMode="numeric"
              className={input}
              style={inputStyle}
              value={draft.show.apha_zone}
              onChange={(e) => setDraft({ ...draft, show: { ...draft.show, apha_zone: e.target.value } })}
            />
          </Field>
          <Field label="APHA show number">
            <input
              className={input}
              style={inputStyle}
              value={draft.show.apha_show_number}
              onChange={(e) => setDraft({ ...draft, show: { ...draft.show, apha_show_number: e.target.value } })}
            />
          </Field>
          <Field label="AQHA show number">
            <input
              className={input}
              style={inputStyle}
              value={draft.show.aqha_show_number}
              onChange={(e) => setDraft({ ...draft, show: { ...draft.show, aqha_show_number: e.target.value } })}
            />
          </Field>
        </div>

        <div className="space-y-2 pt-1">
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Paperwork and grounds</p>
          <Check
            checked={draft.show.requires_coggins}
            onChange={(v) => setDraft({ ...draft, show: { ...draft.show, requires_coggins: v } })}
          >
            Negative Coggins required
          </Check>
          <div className="flex items-center gap-2 flex-wrap">
            <Check
              checked={draft.show.requires_health_certificate}
              onChange={(v) => setDraft({ ...draft, show: { ...draft.show, requires_health_certificate: v } })}
            >
              Health certificate required, issued within
            </Check>
            <input
              inputMode="numeric"
              className="w-16 border rounded px-2 py-1 text-sm"
              style={inputStyle}
              value={draft.show.health_certificate_valid_days}
              disabled={!draft.show.requires_health_certificate}
              onChange={(e) =>
                setDraft({ ...draft, show: { ...draft.show, health_certificate_valid_days: e.target.value } })
              }
            />
            <span className="text-sm">days</span>
          </div>
          <Check
            checked={draft.show.requires_vaccination}
            onChange={(v) => setDraft({ ...draft, show: { ...draft.show, requires_vaccination: v } })}
          >
            Proof of vaccination required
          </Check>
          <Check
            checked={draft.show.shavings_ban_outside}
            onChange={(v) => setDraft({ ...draft, show: { ...draft.show, shavings_ban_outside: v } })}
          >
            No outside shavings — bedding must be bought here
          </Check>
        </div>

        {x.show.staff.length > 0 && (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Officials named on the bill:{' '}
            {x.show.staff.map((s) => `${s.name}${s.role ? ` (${s.role})` : ''}`).join(', ')}. Show staff are
            added in Step 1 once the show exists — the app does not create logins from a show bill.
          </p>
        )}
      </Section>

      {/* ── Venue ── */}
      <Section
        title="Venue"
        aside={
          x.show.venue_name
            ? `The bill says: ${[x.show.venue_name, x.show.venue_city, x.show.venue_state].filter(Boolean).join(', ')}`
            : 'The bill names no venue.'
        }
      >
        <div className="flex gap-4 flex-wrap text-sm">
          {(['existing', 'new', 'none'] as const).map((mode) => (
            <label key={mode} className="flex items-center gap-2" title={mode === 'new' && !canCreateVenue ? 'Only a show manager or an admin can add a venue' : undefined}>
              <input
                type="radio"
                name="venue-mode"
                checked={draft.venue.mode === mode}
                disabled={mode === 'new' && !canCreateVenue}
                onChange={() => setDraft({ ...draft, venue: { ...draft.venue, mode } })}
              />
              {mode === 'existing' ? 'A venue on file' : mode === 'new' ? 'Add it as a new venue' : 'No venue for now'}
            </label>
          ))}
        </div>
        {draft.venue.mode === 'existing' && (
          <select
            className={input}
            style={inputStyle}
            value={draft.venue.venue_id}
            onChange={(e) => setDraft({ ...draft, venue: { ...draft.venue, venue_id: e.target.value } })}
          >
            <option value="">Select a venue…</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {[v.name, v.city, v.state].filter(Boolean).join(', ')}
              </option>
            ))}
          </select>
        )}
        {draft.venue.mode === 'new' && (
          <div className="grid sm:grid-cols-2 gap-3">
            {(['name', 'address', 'city', 'state'] as const).map((k) => (
              <Field key={k} label={k === 'name' ? 'Name *' : k[0].toUpperCase() + k.slice(1)}>
                <input
                  className={input}
                  style={inputStyle}
                  value={draft.venue[k]}
                  onChange={(e) => setDraft({ ...draft, venue: { ...draft.venue, [k]: e.target.value } })}
                />
              </Field>
            ))}
          </div>
        )}
        {!canCreateVenue && x.show.venue_name && (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Only a show manager or an admin can add a venue. Pick one on file, or leave it for the manager.
          </p>
        )}
      </Section>

      {/* ── Judges ── */}
      <Section
        title={`Judges (${draft.judges.filter((j) => j.include).length})`}
        aside="Judges are shared across every show. Pick the one already on file where it is the same person."
      >
        {draft.judges.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            The bill names no judges. Add them in the Judges step.
          </p>
        )}
        <div className="space-y-3">
          {draft.judges.map((j) => (
            <JudgeRow
              key={j.key}
              judge={j}
              registry={registryJudges}
              associations={associations}
              onChange={(patch) => updateJudge(j.key, patch)}
            />
          ))}
        </div>
      </Section>

      {/* ── Clubs ── */}
      <Section title="Club sanctioning" aside="Clubs whose own classes run at the show, besides the breed association.">
        {draft.clubs.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>No sanctioning clubs on the bill.</p>
        )}
        <div className="space-y-3">
          {draft.clubs.map((c) => (
            <div key={c.key} className="rounded border p-3 space-y-2" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <Check checked={c.include} disabled={!c.association_id} onChange={(v) => updateClub(c.key, { include: v })}>
                  <span className="font-medium">{c.printed}</span>
                </Check>
                {c.is_breed_association && (
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>
                    That is the breed association — it is the show&apos;s type, not a club.
                  </span>
                )}
              </div>
              {!c.is_breed_association && (
                <div className="grid sm:grid-cols-3 gap-2">
                  <Field label="Club in the registry">
                    <select
                      className={input}
                      style={inputStyle}
                      value={c.association_id}
                      onChange={(e) => setDraft(mapClub(draft, c.key, e.target.value))}
                    >
                      <option value="">Not in the registry</option>
                      {clubs.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} — {a.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Separate club fee ($)">
                    <input
                      className={input}
                      style={inputStyle}
                      value={c.fee_amount}
                      onChange={(e) => updateClub(c.key, { fee_amount: e.target.value })}
                    />
                  </Field>
                  <Field label="Charged">
                    <select
                      className={input}
                      style={inputStyle}
                      value={c.fee_unit}
                      onChange={(e) => updateClub(c.key, { fee_unit: e.target.value as ClubSanctionUnit })}
                    >
                      {CLUB_SANCTION_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {unitLabel(u)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              )}
              {!c.association_id && !c.is_breed_association && (
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  This club is not in the app&apos;s registry, so its classes cannot be marked. Ask an admin to
                  add it, then designate its classes in the Sanctioning step.
                </p>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* ── Class prices ── */}
      <Section
        title="Class prices"
        aside="The prices the bill quotes. Each class below points at one; change a price here and every class using it follows."
      >
        {draft.rates.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            No class prices were read. Price classes one at a time below, or later in the Fees step.
          </p>
        )}
        <div className="space-y-2">
          {draft.rates.map((r) => {
            const { count, code } = rateJudgeCount(r, panel, associations);
            const total = rateTotals.get(r.key);
            return (
              <div key={r.key} className="grid sm:grid-cols-[1fr_7rem_6.5rem_13rem] gap-2 items-center text-sm">
                <div className="min-w-0">
                  <div style={{ color: 'var(--foreground)' }}>{r.label}</div>
                  {r.printed_text && (
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>
                      Printed: {r.printed_text}
                    </div>
                  )}
                </div>
                <input
                  className={input}
                  style={inputStyle}
                  value={r.amount}
                  aria-label={`${r.label} amount`}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      rates: draft.rates.map((x2) => (x2.key === r.key ? { ...x2, amount: e.target.value } : x2)),
                    })
                  }
                />
                <Check
                  checked={r.per_judge}
                  onChange={(v) =>
                    setDraft({
                      ...draft,
                      rates: draft.rates.map((x2) => (x2.key === r.key ? { ...x2, per_judge: v } : x2)),
                    })
                  }
                >
                  per judge
                </Check>
                <span className="text-xs whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                  {total == null
                    ? 'not a price'
                    : r.per_judge
                      ? `× ${judgesLabel(count, code)} = $${dollarsFromCents(total)}`
                      : `$${dollarsFromCents(total)} a class`}
                </span>
              </div>
            );
          })}
        </div>
        {draft.rates.some((r) => r.per_judge) && panel.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--warning-strong)' }}>
            No judges are on the panel, so every per-judge price works out to $0. Keep the judges above, or type
            the class price in yourself.
          </p>
        )}
      </Section>

      {/* ── Classes ── */}
      <Section
        title={`Classes (${draft.classes.filter((c) => c.include).length} of ${draft.classes.length})`}
        aside="In program order. They are numbered 1, 2, 3… when created, whatever the bill printed."
      >
        {days.map((day) => (
          <div key={day} className="space-y-1">
            <h3 className="text-sm font-semibold pt-2" style={{ color: 'var(--foreground)' }}>
              {formatDay(day)}
            </h3>
            <div className="overflow-x-auto rounded border" style={{ borderColor: 'var(--border-subtle)' }}>
              <table className="w-full text-xs">
                <thead style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--muted)' }}>
                  <tr className="text-left">
                    <th className="p-1.5 w-8" aria-label="Include" />
                    <th className="p-1.5">Bill #</th>
                    <th className="p-1.5 min-w-[14rem]">Class</th>
                    {days.length > 1 && <th className="p-1.5">Day</th>}
                    <th className="p-1.5 min-w-[9rem]">Discipline</th>
                    <th className="p-1.5 min-w-[8rem]">Division</th>
                    <th className="p-1.5 min-w-[5rem]">Code</th>
                    <th className="p-1.5 min-w-[11rem]">Price</th>
                    {clubColumns.length > 0 && <th className="p-1.5">Clubs</th>}
                    <th className="p-1.5" title="Horses are called back into this class rather than entered">
                      Must qualify
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {draft.classes
                    .filter((c) => c.class_date === day)
                    .map((c) => (
                      <ClassRow
                        key={c.key}
                        cls={c}
                        duplicate={dupes.has(c.key)}
                        rates={draft.rates}
                        rateTotals={rateTotals}
                        clubs={clubColumns}
                        days={days}
                        onChange={updateClass}
                      />
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </Section>

      {/* ── Fees ── */}
      <Section
        title="Other fees"
        aside="Stalls, shavings, camping and the show's own charges. Check each one's unit — it decides who pays."
      >
        {draft.fees.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>No other fees were read.</p>
        )}
        <div className="space-y-3">
          {draft.fees.map((f) => (
            <FeeRow key={f.key} fee={f} onChange={(patch) => updateFee(f.key, patch)} />
          ))}
        </div>
      </Section>

      {/* ── Create ── */}
      <div
        className="p-4 rounded-lg border space-y-3"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--warning-bg)' }}
      >
        <Check
          checked={draft.attach_showbill}
          onChange={(v) => setDraft({ ...draft, attach_showbill: v })}
        >
          Keep {imp.original_filename} on file as the show&apos;s own show bill. The Show Bill button stays on
          the one the app generates until you switch it in the Show Bill step.
        </Check>
        <div className="flex items-center justify-end gap-3 flex-wrap">
          {dupes.size > 0 && (
            <span className="text-xs" style={{ color: 'var(--error-strong)' }}>
              {dupes.size} class{dupes.size === 1 ? ' is' : 'es are'} on the same day twice — rename or untick.
            </span>
          )}
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
            title={busy ? 'Creating the show…' : undefined}
            className="text-sm rounded px-4 py-2 disabled:opacity-50"
            style={{ backgroundColor: 'var(--text-deep)', color: 'var(--surface)' }}
          >
            {busy ? 'Creating…' : 'Create draft show →'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Rows ──────────────────────────────────────────────────────────────────────

const ClassRow = memo(function ClassRow({
  cls,
  duplicate,
  rates,
  rateTotals,
  clubs,
  days,
  onChange,
}: {
  cls: DraftClass;
  duplicate: boolean;
  rates: Draft['rates'];
  rateTotals: Map<string, number | null>;
  clubs: { id: string; code: string }[];
  days: string[];
  onChange: (key: string, patch: Partial<DraftClass>) => void;
}) {
  const set = (patch: Partial<DraftClass>) => onChange(cls.key, patch);
  const cents = classCents(cls, rateTotals);
  const priceMode = cls.fee_override != null ? 'custom' : cls.rate_key;
  const faded = cls.include ? undefined : { opacity: 0.5 };
  const cell = 'border rounded px-1.5 py-1 w-full';

  return (
    <>
      <tr className="border-t align-top" style={{ borderColor: 'var(--border-subtle)', ...faded }}>
        <td className="p-1.5">
          <input
            type="checkbox"
            checked={cls.include}
            aria-label={`Include ${cls.class_name}`}
            onChange={(e) => set({ include: e.target.checked })}
          />
        </td>
        <td className="p-1.5 whitespace-nowrap" style={{ color: 'var(--muted)' }}>
          {cls.number ?? '—'}
        </td>
        <td className="p-1.5">
          <input
            className={cell}
            style={{ ...inputStyle, ...(duplicate ? { borderColor: 'var(--error)' } : {}) }}
            value={cls.class_name}
            onChange={(e) => set({ class_name: e.target.value })}
          />
        </td>
        {days.length > 1 && (
          <td className="p-1.5">
            <select
              className={cell}
              style={inputStyle}
              value={cls.class_date}
              aria-label="Day"
              onChange={(e) => set({ class_date: e.target.value })}
            >
              {days.map((d) => (
                <option key={d} value={d}>
                  {shortDay(d)}
                </option>
              ))}
            </select>
          </td>
        )}
        <td className="p-1.5">
          <input className={cell} style={inputStyle} value={cls.discipline} onChange={(e) => set({ discipline: e.target.value })} />
        </td>
        <td className="p-1.5">
          <input className={cell} style={inputStyle} value={cls.bracket} onChange={(e) => set({ bracket: e.target.value })} />
        </td>
        <td className="p-1.5">
          <input
            className={cell}
            style={inputStyle}
            value={cls.association_class_code}
            onChange={(e) => set({ association_class_code: e.target.value })}
          />
        </td>
        <td className="p-1.5">
          <select
            className={cell}
            style={inputStyle}
            value={priceMode}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'custom') set({ fee_override: dollarsFromCents(cents ?? 0) });
              else set({ rate_key: v, fee_override: null });
            }}
          >
            <option value="">$0 (no price)</option>
            {rates.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
            <option value="custom">Type a price…</option>
          </select>
          {cls.fee_override != null ? (
            <input
              className={`${cell} mt-1`}
              style={inputStyle}
              value={cls.fee_override}
              aria-label="Class price"
              onChange={(e) => set({ fee_override: e.target.value })}
            />
          ) : (
            <div className="mt-0.5" style={{ color: 'var(--muted)' }}>
              {cents == null ? 'not a price' : `$${dollarsFromCents(cents)}`}
            </div>
          )}
        </td>
        {clubs.length > 0 && (
          <td className="p-1.5">
            <div className="flex flex-col gap-0.5">
              {clubs.map((club) => (
                <label key={club.id} className="flex items-center gap-1 whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={cls.club_association_ids.includes(club.id)}
                    onChange={(e) =>
                      set({
                        club_association_ids: e.target.checked
                          ? [...cls.club_association_ids, club.id]
                          : cls.club_association_ids.filter((id) => id !== club.id),
                      })
                    }
                  />
                  {club.code}
                </label>
              ))}
            </div>
          </td>
        )}
        <td className="p-1.5 text-center">
          <input
            type="checkbox"
            checked={cls.entered_by_qualification}
            aria-label="Must qualify"
            onChange={(e) => set({ entered_by_qualification: e.target.checked })}
          />
        </td>
      </tr>
      {(duplicate || cls.note || cls.is_futurity || cls.unknown_club_codes.length > 0) && (
        <tr style={faded}>
          <td />
          <td colSpan={7 + (clubs.length > 0 ? 1 : 0) + (days.length > 1 ? 1 : 0)} className="px-1.5 pb-1.5 space-y-0.5">
            {duplicate && <Note tone="error">Another class of this name runs this day. Rename one or untick it.</Note>}
            {cls.is_futurity && (
              <Note tone={(cents ?? 0) > 0 ? 'warn' : 'muted'}>
                Futurity class — the futurity prices it, so it should stay at $0. Set the futurity up in the
                Futurities step and add this class to it.
              </Note>
            )}
            {cls.unknown_club_codes.length > 0 && (
              <Note tone="muted">
                The bill marks this class {cls.unknown_club_codes.join(', ')}, which is not a club in the registry.
              </Note>
            )}
            {cls.note && <Note tone="muted">{cls.note}</Note>}
          </td>
        </tr>
      )}
    </>
  );
});

function JudgeRow({
  judge,
  registry,
  associations,
  onChange,
}: {
  judge: DraftJudge;
  registry: RegistryJudge[];
  associations: Association[];
  onChange: (patch: Partial<DraftJudge>) => void;
}) {
  const candidates = registry.filter((r) => judge.candidate_ids.includes(r.id));
  const others = registry.filter((r) => !judge.candidate_ids.includes(r.id));
  const label = (r: RegistryJudge) =>
    `${r.last_name}, ${r.first_name}${r.email ? ` (${r.email})` : ''}${
      r.associations.length ? ` — ${r.associations.map((a) => a.code).join('/')}` : ''
    }`;

  return (
    <div className="rounded border p-3 space-y-2" style={{ borderColor: 'var(--border-subtle)', opacity: judge.include ? 1 : 0.6 }}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Check checked={judge.include} onChange={(v) => onChange({ include: v })}>
          <span className="font-medium">{judge.printed}</span>
        </Check>
        <div className="flex gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input type="radio" checked={judge.mode === 'existing'} onChange={() => onChange({ mode: 'existing' })} />
            On file
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" checked={judge.mode === 'new'} onChange={() => onChange({ mode: 'new' })} />
            New judge
          </label>
        </div>
      </div>
      {judge.mode === 'existing' ? (
        <>
          <select
            className={input}
            style={inputStyle}
            value={judge.judge_id}
            onChange={(e) => onChange({ judge_id: e.target.value, matched_on: null })}
          >
            <option value="">Select a judge…</option>
            {candidates.length > 0 && (
              <optgroup label="Same name">
                {candidates.map((r) => (
                  <option key={r.id} value={r.id}>
                    {label(r)}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Everyone on file">
              {others.map((r) => (
                <option key={r.id} value={r.id}>
                  {label(r)}
                </option>
              ))}
            </optgroup>
          </select>
          {judge.matched_on === 'name' && (
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Matched on the name alone — check it is the same person.
            </p>
          )}
        </>
      ) : (
        <div className="space-y-2">
          <div className="grid sm:grid-cols-3 gap-2">
            <Field label="First name *">
              <input className={input} style={inputStyle} value={judge.first_name} onChange={(e) => onChange({ first_name: e.target.value })} />
            </Field>
            <Field label="Last name *">
              <input className={input} style={inputStyle} value={judge.last_name} onChange={(e) => onChange({ last_name: e.target.value })} />
            </Field>
            <Field label="Email">
              <input type="email" className={input} style={inputStyle} value={judge.email} onChange={(e) => onChange({ email: e.target.value })} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className="text-xs w-full" style={{ color: 'var(--muted)' }}>Carded with</span>
            {associations.map((a) => (
              <Check
                key={a.id}
                checked={judge.association_ids.includes(a.id)}
                onChange={(v) =>
                  onChange({
                    association_ids: v
                      ? [...judge.association_ids, a.id]
                      : judge.association_ids.filter((id) => id !== a.id),
                  })
                }
              >
                {a.code}
              </Check>
            ))}
          </div>
          {candidates.length > 0 && (
            <p className="text-xs" style={{ color: 'var(--warning-strong)' }}>
              {candidates.length === 1 ? 'Somebody' : `${candidates.length} people`} with this name{' '}
              {candidates.length === 1 ? 'is' : 'are'} already on file. Pick them instead if it is the same person.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FeeRow({ fee, onChange }: { fee: DraftFee; onChange: (patch: Partial<DraftFee>) => void }) {
  const family = feeFamily(fee.unit);
  const amount = centsFromDollars(fee.amount);
  // Open only where the bill printed an early rate. Every stall and hook-up
  // line can carry one, and a pair of empty boxes under each of them reads as
  // something the bill left out.
  const [earlyOpen, setEarlyOpen] = useState(Boolean(fee.early_amount || fee.early_deadline));
  const showEarly = canHaveEarlyRate(fee.unit) && earlyOpen;
  return (
    <div className="rounded border p-3 space-y-2" style={{ borderColor: 'var(--border-subtle)', opacity: fee.include ? 1 : 0.6 }}>
      <div className="grid sm:grid-cols-[auto_1fr_7rem_12rem] gap-2 items-end">
        <input
          type="checkbox"
          className="mb-2"
          checked={fee.include}
          aria-label={`Include ${fee.label}`}
          onChange={(e) => onChange({ include: e.target.checked })}
        />
        <Field label="Fee">
          <input className={input} style={inputStyle} value={fee.label} onChange={(e) => onChange({ label: e.target.value })} />
        </Field>
        <Field label="Amount ($)">
          <input className={input} style={inputStyle} value={fee.amount} onChange={(e) => onChange({ amount: e.target.value })} />
        </Field>
        <Field label="Charged">
          <select
            className={input}
            style={inputStyle}
            value={fee.unit}
            onChange={(e) => {
              const unit = e.target.value as FeeUnit;
              onChange({
                unit,
                // The fee editors refuse both on a unit that cannot carry them;
                // clear rather than leave a value the press will be refused over.
                ...(canHaveEarlyRate(unit) ? {} : { early_amount: '', early_deadline: '' }),
                ...(canHaveMinimumQuantity(unit) ? {} : { min_quantity: '' }),
              });
            }}
          >
            {FEE_UNIT_OPTIONS.map((u) => (
              <option key={u} value={u}>
                {unitLabel(u)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="text-xs" style={{ color: family.tone === 'warn' ? 'var(--warning-strong)' : 'var(--muted)' }}>
        {family.text}
        {amount == null && ' The amount is not a price.'}
        {canHaveEarlyRate(fee.unit) && !earlyOpen && (
          <>
            {' '}
            <button type="button" className="underline" style={{ color: 'var(--primary)' }} onClick={() => setEarlyOpen(true)}>
              Add an early rate
            </button>
          </>
        )}
      </p>
      {(showEarly || canHaveMinimumQuantity(fee.unit)) && (
        <div className="grid sm:grid-cols-3 gap-2">
          {showEarly && (
            <>
              <Field label="Early rate ($)">
                <input className={input} style={inputStyle} value={fee.early_amount} onChange={(e) => onChange({ early_amount: e.target.value })} />
              </Field>
              <Field label="Early rate until">
                <input
                  type="date"
                  className={input}
                  style={inputStyle}
                  value={fee.early_deadline}
                  onChange={(e) => onChange({ early_deadline: e.target.value })}
                />
              </Field>
            </>
          )}
          {canHaveMinimumQuantity(fee.unit) && (
            <Field label="Minimum bags per sign-up">
              <input
                inputMode="numeric"
                className={input}
                style={inputStyle}
                value={fee.min_quantity}
                onChange={(e) => onChange({ min_quantity: e.target.value })}
              />
            </Field>
          )}
        </div>
      )}
      <Field label="Note for the show bill">
        <input className={input} style={inputStyle} value={fee.notes} onChange={(e) => onChange({ notes: e.target.value })} />
      </Field>
    </div>
  );
}

// ── Small pieces ──────────────────────────────────────────────────────────────

function Section({ title, aside, children }: { title: string; aside?: string; children: React.ReactNode }) {
  return (
    <section className="p-4 rounded-lg border space-y-3" style={box}>
      <div>
        <h2 className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>
          {title}
        </h2>
        {aside && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            {aside}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function Check({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-start gap-2 text-sm" style={{ color: 'var(--foreground)' }}>
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}

function Note({ tone, children }: { tone: 'error' | 'warn' | 'muted'; children: React.ReactNode }) {
  const color = tone === 'error' ? 'var(--error-strong)' : tone === 'warn' ? 'var(--warning-strong)' : 'var(--muted)';
  return <div style={{ color }}>{children}</div>;
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
