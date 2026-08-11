'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type PreviewClass = {
  id: string;
  class_number: string;
  class_name: string;
  class_date: string;
  entry_fee_cents: number;
  is_nsba_approved: boolean;
  nsba_sanction_cents: number;
};

type HealthCheck = {
  code: string;
  label: string;
  status: 'valid' | 'missing' | 'undated' | 'expired';
  message: string;
  expiry_date: string | null;
};

type PreviewHorse = {
  id: string;
  name: string;
  /** Advisory, never a gate — see `healthWarnings` below. */
  health?: HealthCheck[];
};

type ExistingEntry = { id: string; class_id: string; horse_id: string | null };

type Signup = {
  show_entry_id: string;
  registered_at: string;
  back_number: number | null;
  arrival_date: string | null;
  departure_date: string | null;
  notes: string | null;
  reservations: { show_fee_id: string; quantity: number }[];
};

export type PreviewData = {
  /** Null until the exhibitor completes show sign-up. The POST rejects class
   *  entries without it, so the form refuses to render the picker rather than
   *  letting someone fill it in and be turned away on submit. */
  signup: Signup | null;
  show: {
    id: string;
    name: string;
    status: string;
    start_date: string;
    end_date: string;
    show_type_code: string | null;
    office_charge_cents: number;
    office_charge_basis: string;
  };
  exhibitor: { id: string; full_name: string };
  classes: PreviewClass[];
  horses: PreviewHorse[];
  existing_entries: ExistingEntry[];
};

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * What this horse still needs before the show — not before registering.
 *
 * A lapsed Coggins used to stop the entry going in at all, which helped nobody:
 * the paperwork was no more current for the horse having been turned away, and
 * the show office only found out when the trailer arrived. The entry goes
 * through, the exhibitor sees this, and the office sees the same list on its
 * own screen with time to chase it.
 */
function healthWarnings(horse: PreviewHorse): string[] {
  return (horse.health ?? [])
    .filter((check) => check.status !== 'valid')
    .map((check) => check.message);
}

/**
 * One class the exhibitor is already entered in, with the control to get back
 * out of it. Removal is a labelled button rather than a link tucked inside the
 * "entered" badge: taking a class off is as ordinary an action as adding one,
 * and an entry with no placing yet is the exhibitor's to undo.
 */
function EnteredRow({
  entry,
  className,
  horseName,
  isConfirming,
  isRemoving,
  onAsk,
  onCancel,
  onConfirm,
}: {
  entry: ExistingEntry;
  className: string;
  horseName: string;
  isConfirming: boolean;
  isRemoving: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="flex items-center justify-between gap-2 rounded px-2 py-1.5"
      style={{ backgroundColor: '#dcfce7' }}
    >
      <span className="text-xs min-w-0 truncate" style={{ color: '#065f46' }}>
        ✓ Entered · 🐴 {horseName}
      </span>
      {isConfirming ? (
        <span className="flex items-center gap-2 shrink-0">
          <span className="text-xs" style={{ color: '#065f46' }}>Remove?</span>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isRemoving}
            className="text-xs font-medium px-2 py-1 rounded text-white disabled:opacity-50"
            style={{ backgroundColor: '#b91c1c' }}
          >
            {isRemoving ? 'Removing…' : 'Yes, remove'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={isRemoving}
            className="text-xs hover:underline"
            style={{ color: '#15803d' }}
          >
            Keep
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={onAsk}
          className="text-xs font-medium px-2 py-1 rounded border shrink-0"
          style={{ borderColor: '#86efac', color: '#065f46', backgroundColor: '#ffffff' }}
          title={`Remove ${horseName} from ${className}`}
          aria-label={`Remove ${horseName} from ${className}`}
          data-entry-id={entry.id}
        >
          Remove
        </button>
      )}
    </div>
  );
}

export default function RegisterShowForm({ showId, preview }: { showId: string; preview: PreviewData }) {
  const router = useRouter();
  const { show, exhibitor, classes, horses, existing_entries } = preview;

  // class_id -> horse_id ("" = not selected)
  const initialSelection = useMemo(() => {
    const seed: Record<string, string> = {};
    for (const cls of classes) seed[cls.id] = '';
    return seed;
  }, [classes]);

  const [selection, setSelection] = useState<Record<string, string>>(initialSelection);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmWithdrawEntryId, setConfirmWithdrawEntryId] = useState<string | null>(null);
  const [withdrawingEntryId, setWithdrawingEntryId] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const existingByClass = useMemo(() => {
    const map = new Map<string, ExistingEntry[]>();
    for (const e of existing_entries) {
      const list = map.get(e.class_id) ?? [];
      list.push(e);
      map.set(e.class_id, list);
    }
    return map;
  }, [existing_entries]);

  const existingHorseIdsByClass = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const e of existing_entries) {
      const list = map.get(e.class_id) ?? [];
      if (e.horse_id) list.push(e.horse_id);
      map.set(e.class_id, list);
    }
    return map;
  }, [existing_entries]);

  const horseNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of horses) m.set(h.id, h.name);
    return m;
  }, [horses]);
  const horsesNeedingRecords = useMemo(
    () => horses.filter((h) => healthWarnings(h).length > 0),
    [horses],
  );

  const selectedClassIds = Object.keys(selection).filter((cid) => selection[cid]);
  const classById = useMemo(() => {
    const m = new Map<string, PreviewClass>();
    for (const c of classes) m.set(c.id, c);
    return m;
  }, [classes]);

  const subtotalCents = selectedClassIds.reduce(
    (sum, cid) => sum + (classById.get(cid)?.entry_fee_cents ?? 0),
    0,
  );
  const sanctionCents = selectedClassIds.reduce(
    (sum, cid) => sum + (classById.get(cid)?.nsba_sanction_cents ?? 0),
    0,
  );
  const distinctHorsesSelected = new Set(
    selectedClassIds.map((cid) => selection[cid]).filter(Boolean),
  ).size;
  // Mirrors office_charge_total_cents() in backend/billing.py: per_back_number
  // is one charge for the exhibitor however many horses they bring.
  const officeChargeTotalCents =
    selectedClassIds.length === 0
      ? 0
      : show.office_charge_basis === 'per_horse'
        ? distinctHorsesSelected * show.office_charge_cents
        : show.office_charge_cents;
  const totalFee = subtotalCents + sanctionCents + officeChargeTotalCents;

  const classesByDate = useMemo(() => {
    const grouped = new Map<string, PreviewClass[]>();
    for (const cls of classes) {
      const list = grouped.get(cls.class_date) ?? [];
      list.push(cls);
      grouped.set(cls.class_date, list);
    }
    return Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [classes]);

  const handleSelect = (classId: string, horseId: string) => {
    setSelection((prev) => ({ ...prev, [classId]: horseId }));
  };

  const handleWithdraw = async (entryId: string) => {
    setWithdrawError(null);
    setWithdrawingEntryId(entryId);
    try {
      const res = await fetch(`/api/shows/${showId}/register/entries/${entryId}`, {
        method: 'DELETE',
      });
      if (res.status !== 204 && !res.ok) {
        const json = await res.json().catch(() => ({}));
        const detail = typeof json?.detail === 'string'
          ? json.detail
          : json?.detail?.message || json?.error || 'Withdraw failed';
        setWithdrawError(detail);
        setWithdrawingEntryId(null);
        return;
      }
      setConfirmWithdrawEntryId(null);
      setWithdrawingEntryId(null);
      router.refresh();
    } catch {
      setWithdrawError('Network error — please try again.');
      setWithdrawingEntryId(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const entries = selectedClassIds.map((cid) => ({
      class_id: cid,
      horse_id: selection[cid],
    }));
    if (entries.length === 0) {
      setError('Pick a horse for at least one class to register.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/shows/${showId}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      });
      const json = await res.json();
      if (!res.ok) {
        const detail = typeof json?.detail === 'string'
          ? json.detail
          : json?.detail?.message || json?.error || 'Registration failed';
        setError(detail);
        setSubmitting(false);
        return;
      }
      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('Network error — please try again.');
      setSubmitting(false);
    }
  };

  if (!preview.signup) {
    return (
      <div className="mt-6">
        <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>{show.name}</h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          Register for classes — {exhibitor.full_name}
        </p>
        <div
          className="mt-6 rounded-lg border p-4 text-sm"
          style={{ backgroundColor: '#fef3c7', borderColor: '#fde68a', color: '#92400e' }}
        >
          <p className="font-medium">Sign up for the show first.</p>
          <p className="mt-1">
            The show office needs your stall, shavings, and camping numbers before you pick classes.
            It only takes a minute, and you can change those numbers later.
          </p>
          <div className="mt-3">
            <Link
              href={`/shows/${show.id}/signup`}
              className="inline-block px-4 py-2 rounded font-medium text-white"
              style={{ backgroundColor: '#8b4513' }}
            >
              Sign up for this show →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (horses.length === 0) {
    return (
      <div className="mt-6">
        <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>{show.name}</h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          Register for classes — {exhibitor.full_name}
        </p>
        <div
          className="mt-6 rounded-lg border p-4 text-sm"
          style={{ backgroundColor: '#fef3c7', borderColor: '#fde68a', color: '#92400e' }}
        >
          You don&apos;t have any horses on your profile yet. Add a horse before registering.
          <div className="mt-3">
            <Link href="/profile" className="font-medium hover:underline" style={{ color: '#8b4513' }}>
              Manage my horses →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6">
      <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>{show.name}</h1>
      <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
        Register for classes — {exhibitor.full_name}
      </p>

      <div
        className="mt-4 rounded-lg border p-3 text-sm"
        style={{ backgroundColor: '#faf7f2', borderColor: '#d4b896', color: '#5d4a37' }}
      >
        Pick a horse for each class you want to enter. The show secretary assigns your back number
        once the show begins. Fees shown are informational — payment is collected at the show.
        <div className="mt-2">
          <Link
            href={`/shows/${showId}/signup`}
            className="text-sm font-medium hover:underline"
            style={{ color: '#8b4513' }}
          >
            Change stalls, shavings or camping →
          </Link>
        </div>
      </div>

      {existing_entries.length > 0 && (
        <section
          className="mt-4 rounded-lg border p-3"
          style={{ borderColor: '#86efac', backgroundColor: '#f0fdf4' }}
        >
          <h2 className="text-sm font-semibold" style={{ color: '#065f46' }}>
            You&apos;re entered in {existing_entries.length} class
            {existing_entries.length === 1 ? '' : 'es'}
          </h2>
          <p className="text-xs mt-0.5 mb-2" style={{ color: '#15803d' }}>
            Entered by mistake? Remove it here — nothing is final until the show starts.
          </p>
          <ul className="space-y-1.5">
            {existing_entries.map((e) => {
              const cls = classById.get(e.class_id);
              return (
                <li key={e.id} className="flex flex-col gap-1">
                  <span className="text-xs font-medium" style={{ color: '#065f46' }}>
                    {cls ? `${cls.class_number} — ${cls.class_name}` : 'Class'}
                  </span>
                  <EnteredRow
                    entry={e}
                    className={cls?.class_name ?? 'this class'}
                    horseName={e.horse_id ? (horseNameById.get(e.horse_id) ?? 'horse') : 'horse'}
                    isConfirming={confirmWithdrawEntryId === e.id}
                    isRemoving={withdrawingEntryId === e.id}
                    onAsk={() => { setConfirmWithdrawEntryId(e.id); setWithdrawError(null); }}
                    onCancel={() => { setConfirmWithdrawEntryId(null); setWithdrawError(null); }}
                    onConfirm={() => handleWithdraw(e.id)}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {horsesNeedingRecords.length > 0 && (
        <div
          className="mt-3 rounded-lg border p-3 space-y-2"
          style={{ borderColor: '#fde68a', backgroundColor: '#fffbeb' }}
        >
          <p className="text-sm font-medium" style={{ color: '#92400e' }}>
            {horsesNeedingRecords.length === 1 ? '1 horse needs' : `${horsesNeedingRecords.length} horses need`} health records updated before the show
          </p>
          <p className="text-xs" style={{ color: '#92400e' }}>
            You can still enter these classes now. The show office is sent the same list and will
            expect current paperwork by the time you ship in.
          </p>
          <ul className="space-y-1.5">
            {horsesNeedingRecords.map((h) => {
              const warnings = healthWarnings(h);
              return (
                <li key={h.id} className="flex items-center justify-between gap-3 text-sm">
                  <span style={{ color: '#7c2d12' }}>
                    <span className="font-medium">{h.name}</span>
                    {' — '}
                    {warnings[0] ?? 'documents needed'}
                  </span>
                  <Link
                    href={`/profile/horses/${h.id}`}
                    className="shrink-0 text-xs font-medium hover:underline"
                    style={{ color: '#8b4513' }}
                  >
                    Upload documents →
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-6 space-y-6">
        {classesByDate.map(([dateStr, dayClasses]) => (
          <section key={dateStr}>
            <div className="flex items-center gap-2 mb-2">
              <div className="flex-1 h-px" style={{ backgroundColor: '#e8d5b7' }} />
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{ color: '#8b4513', backgroundColor: '#f0e8d8' }}
              >
                {formatDate(dateStr)}
              </span>
              <div className="flex-1 h-px" style={{ backgroundColor: '#e8d5b7' }} />
            </div>

            <ul className="space-y-2">
              {dayClasses.map((cls) => {
                const existing = existingByClass.get(cls.id) ?? [];
                const existingHorseIds = existingHorseIdsByClass.get(cls.id) ?? [];
                return (
                  <li
                    key={cls.id}
                    className="rounded-lg border p-3"
                    style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium" style={{ color: '#2c1810' }}>
                          {cls.class_number} — {cls.class_name}
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: '#8b7355' }}>
                          {cls.entry_fee_cents > 0 ? `Fee ${formatMoney(cls.entry_fee_cents)}` : 'No fee'}
                          {cls.is_nsba_approved && (
                            <span
                              className="ml-2 font-mono font-semibold px-1 rounded"
                              style={{ backgroundColor: '#f0e8d8', color: '#8b4513' }}
                              title={`NSBA-approved. Adds ${formatMoney(cls.nsba_sanction_cents)} sanction fee.`}
                            >
                              NSBA
                            </span>
                          )}
                        </div>
                        {existing.length > 0 && (
                          <ul className="mt-2 space-y-1.5">
                            {existing.map((e) => (
                              <li key={e.id}>
                                <EnteredRow
                                  entry={e}
                                  className={cls.class_name}
                                  horseName={
                                    e.horse_id ? (horseNameById.get(e.horse_id) ?? 'horse') : 'horse'
                                  }
                                  isConfirming={confirmWithdrawEntryId === e.id}
                                  isRemoving={withdrawingEntryId === e.id}
                                  onAsk={() => { setConfirmWithdrawEntryId(e.id); setWithdrawError(null); }}
                                  onCancel={() => { setConfirmWithdrawEntryId(null); setWithdrawError(null); }}
                                  onConfirm={() => handleWithdraw(e.id)}
                                />
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="shrink-0">
                        <select
                          aria-label={`Horse for ${cls.class_name}`}
                          value={selection[cls.id] ?? ''}
                          onChange={(e) => handleSelect(cls.id, e.target.value)}
                          className="text-sm border rounded px-2 py-1.5"
                          style={{ borderColor: '#d4b896', backgroundColor: '#fffdf8' }}
                        >
                          <option value="">— skip —</option>
                          {horses.map((h) => {
                            const already = existingHorseIds.includes(h.id);
                            // Only "entered" disables an option. A health
                            // warning is marked, not enforced — the banner
                            // above says what is outstanding.
                            const needsRecords = healthWarnings(h).length > 0;
                            return (
                              <option key={h.id} value={h.id} disabled={already}>
                                {h.name}{already ? ' (entered)' : needsRecords ? ' ⚠ records due' : ''}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <div
        className="mt-8 rounded-lg border p-4 sticky bottom-4 space-y-3"
        style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider" style={{ color: '#8b7355' }}>
              {selectedClassIds.length} class{selectedClassIds.length === 1 ? '' : 'es'} selected
              {distinctHorsesSelected > 0 && (
                <> · {distinctHorsesSelected} horse{distinctHorsesSelected === 1 ? '' : 's'}</>
              )}
            </div>
            <div className="text-xl font-bold" style={{ color: '#2c1810' }}>
              Total {formatMoney(totalFee)}
            </div>
          </div>
          <button
            type="submit"
            disabled={submitting || selectedClassIds.length === 0}
            className="px-4 py-2 rounded font-medium text-white"
            style={{
              backgroundColor: submitting || selectedClassIds.length === 0 ? '#a89175' : '#8b4513',
              cursor: submitting || selectedClassIds.length === 0 ? 'not-allowed' : 'pointer',
            }}
            title={selectedClassIds.length === 0 ? 'Pick at least one class to register' : undefined}
          >
            {submitting ? 'Submitting…' : 'Submit registration'}
          </button>
        </div>
        {selectedClassIds.length > 0 && (sanctionCents > 0 || officeChargeTotalCents > 0) && (
          <dl className="text-xs grid grid-cols-2 gap-y-1 pt-2 border-t" style={{ borderColor: '#e8d5b7', color: '#5d4a37' }}>
            <dt>Class fees</dt>
            <dd className="text-right">{formatMoney(subtotalCents)}</dd>
            {sanctionCents > 0 && (
              <>
                <dt title="NSBA sanction fee: 6% of class fee, $3 minimum, on each NSBA-approved class.">
                  NSBA sanction fees
                </dt>
                <dd className="text-right">{formatMoney(sanctionCents)}</dd>
              </>
            )}
            {officeChargeTotalCents > 0 && (
              <>
                <dt title="One-time office/drug-testing charge per horse.">
                  Office charge ({distinctHorsesSelected} × {formatMoney(show.office_charge_cents)})
                </dt>
                <dd className="text-right">{formatMoney(officeChargeTotalCents)}</dd>
              </>
            )}
          </dl>
        )}
      </div>

      {(error || withdrawError) && (
        <div
          className="mt-4 rounded-lg border p-3 text-sm"
          style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }}
        >
          {error ?? withdrawError}
        </div>
      )}
    </form>
  );
}
