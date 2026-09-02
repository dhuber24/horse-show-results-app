'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  UNIT_LABEL as UNIT_LABELS,
  isAutomaticUnit,
  type FeeUnit as Unit,
} from '@/lib/fee-units';

interface ShowFee {
  id: string;
  show_id: string;
  code: string;
  label: string;
  amount_cents: number;
  unit: Unit;
  notes: string | null;
  sort_order: number;
  early_amount_cents: number | null;
  /** The show's minimum for this line, 0 when there is none. */
  min_quantity?: number;
  early_deadline: string | null;
  /** How many exhibitors have booked a quantity against this row. */
  reserved_count?: number;
}

interface Props {
  showId: string;
  initialFees: ShowFee[];
}

const BOARDING_UNIT_OPTIONS: Unit[] = [
  'flat',
  'per_entry',
  'per_night',
  'per_day',
  'per_stall',
  'per_bag',
  'per_show',
  'percent_of_entry',
  'per_class_per_horse',
];

/** Units an exhibitor books a quantity of at sign-up. Only these can carry an
 *  early rate — nothing else produces a reservation for a discount to apply
 *  to, and the backend rejects one on any other unit. Mirrors
 *  RESERVABLE_FEE_UNITS in backend/billing.py. */
const RESERVABLE_UNITS = new Set<Unit>([
  'per_stall',
  'per_bag',
  'per_night',
  'per_day',
  'per_show',
]);

/** Units a show can require of everybody, which is narrower than the ones an
 *  exhibitor books a quantity of. A minimum is a policy — "every rig takes a
 *  stall", "we will not have horses bedded on less than this" — and camping is
 *  not one: nobody makes an exhibitor book a spot to be allowed to enter.
 *  Mirrors REQUIRABLE_FEE_UNITS in backend/reservations.py, which refuses a
 *  minimum on any other unit. */
const REQUIRABLE_UNITS = new Set<Unit>(['per_stall', 'per_bag']);

function dollarsFromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

function centsFromDollars(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(parseFloat(trimmed) * 100);
}

type Draft = {
  label: string;
  amount: string;
  unit: Unit;
  early: string;
  earlyDeadline: string;
  /** The fewest an exhibitor may reserve once they reserve any (migration
   *  128), as typed. Blank and "0" both mean no floor. */
  minQuantity: string;
};

/** The floor as a number the backend will take. Anything that is not a whole
 *  number above zero means "no minimum" — a show that has not answered the
 *  question must not end up with one. Cleared outright on a unit a show cannot
 *  require of everybody — a stray value on a camping row would otherwise go on
 *  refusing sign-ups from a box nothing renders any more. */
function minQuantityOf(draft: Draft): number {
  if (!REQUIRABLE_UNITS.has(draft.unit)) return 0;
  const n = Number.parseInt(draft.minQuantity, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 999) : 0;
}

function draftFromFee(f: ShowFee): Draft {
  return {
    label: f.label,
    amount: dollarsFromCents(f.amount_cents),
    unit: f.unit,
    early: f.early_amount_cents != null ? dollarsFromCents(f.early_amount_cents) : '',
    earlyDeadline: f.early_deadline ?? '',
    minQuantity: f.min_quantity ? String(f.min_quantity) : '',
  };
}

type EarlyFields = { early_amount_cents: number | null; early_deadline: string | null };

/** The early-bird half of a fee payload, or the reason it can't be sent.
 *  Checked here as well as server-side so the secretary is told which row is
 *  wrong instead of getting a bare 422 from the save button. */
function earlyFields(draft: Draft, standardCents: number): EarlyFields | { error: string } {
  const hasAmount = draft.early.trim() !== '';
  const hasDeadline = draft.earlyDeadline.trim() !== '';
  // Switching a row to a non-reservable unit clears its early rate rather than
  // erroring — the secretary changed what the fee *is*, and the discount no
  // longer has a reservation to attach to.
  if ((!hasAmount && !hasDeadline) || !RESERVABLE_UNITS.has(draft.unit)) {
    return { early_amount_cents: null, early_deadline: null };
  }
  if (hasAmount !== hasDeadline) {
    return { error: 'An early rate needs both a discounted amount and a "reserve by" date.' };
  }
  const cents = centsFromDollars(draft.early);
  if (cents === null) return { error: 'Invalid early rate amount.' };
  if (cents > standardCents) {
    return { error: 'The early rate must be lower than the standard rate.' };
  }
  return { early_amount_cents: cents, early_deadline: draft.earlyDeadline };
}

export default function BoardingFeesEditor({ showId, initialFees }: Props) {
  const router = useRouter();
  const [fees, setFees] = useState(initialFees);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(
    Object.fromEntries(initialFees.map((f) => [f.id, draftFromFee(f)])),
  );
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState({
    code: '',
    label: '',
    amount: '',
    unit: 'per_stall' as Unit,
    early: '',
    earlyDeadline: '',
    minQuantity: '',
  });
  const [showAddForm, setShowAddForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refreshDrafts = (next: ShowFee[]) => {
    setDrafts(Object.fromEntries(next.map((f) => [f.id, draftFromFee(f)])));
  };

  const seedDefaults = async () => {
    setError(null);
    const res = await fetch(`/api/shows/${showId}/fees/seed`, { method: 'POST' });
    if (res.ok) {
      const seeded: ShowFee[] = await res.json();
      const boardingSeeded = seeded.filter((f) => !isAutomaticUnit(f.unit));
      const merged = [...fees, ...boardingSeeded].sort((a, b) => a.sort_order - b.sort_order);
      setFees(merged);
      refreshDrafts(merged);
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to seed defaults.');
    }
  };

  const saveRow = async (fee: ShowFee) => {
    const draft = drafts[fee.id];
    const cents = centsFromDollars(draft.amount);
    if (cents === null) { setError(`Invalid amount for ${fee.label}.`); return; }
    const early = earlyFields(draft, cents);
    if ('error' in early) { setError(`${fee.label}: ${early.error}`); return; }
    setBusyId(fee.id);
    setError(null);
    const res = await fetch(`/api/shows/${showId}/fees/${fee.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: draft.label,
        amount_cents: cents,
        unit: draft.unit,
        min_quantity: minQuantityOf(draft),
        ...early,
      }),
    });
    setBusyId(null);
    if (res.ok) {
      const updated: ShowFee = await res.json();
      setFees((prev) => prev.map((f) => (f.id === fee.id ? updated : f)));
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? `Failed to save ${fee.label}.`);
    }
  };

  const removeRow = async (fee: ShowFee) => {
    setBusyId(fee.id);
    const res = await fetch(`/api/shows/${showId}/fees/${fee.id}`, { method: 'DELETE' });
    setBusyId(null);
    setConfirmDeleteId(null);
    if (res.ok || res.status === 204) {
      setFees((prev) => prev.filter((f) => f.id !== fee.id));
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to remove fee.');
    }
  };

  const addNew = async () => {
    if (!newRow.label.trim()) { setError('Label is required.'); return; }
    const cents = centsFromDollars(newRow.amount);
    if (cents === null) { setError('Invalid amount.'); return; }
    const early = earlyFields(
      {
        label: newRow.label,
        amount: newRow.amount,
        unit: newRow.unit,
        early: newRow.early,
        earlyDeadline: newRow.earlyDeadline,
        minQuantity: newRow.minQuantity,
      },
      cents,
    );
    if ('error' in early) { setError(early.error); return; }
    setAdding(true);
    setError(null);
    const code = newRow.code.trim() || newRow.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 64);
    const res = await fetch(`/api/shows/${showId}/fees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        label: newRow.label.trim(),
        amount_cents: cents,
        unit: newRow.unit,
        sort_order: fees.length,
        min_quantity: minQuantityOf({
          label: newRow.label,
          amount: newRow.amount,
          unit: newRow.unit,
          early: newRow.early,
          earlyDeadline: newRow.earlyDeadline,
          minQuantity: newRow.minQuantity,
        }),
        ...early,
      }),
    });
    setAdding(false);
    if (res.ok) {
      const created: ShowFee = await res.json();
      const merged = [...fees, created];
      setFees(merged);
      setDrafts((prev) => ({ ...prev, [created.id]: draftFromFee(created) }));
      setNewRow({ code: '', label: '', amount: '', unit: 'per_stall', early: '', earlyDeadline: '', minQuantity: '' });
      setShowAddForm(false);
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to add fee.');
    }
  };

  return (
    <section className="rounded-lg border p-4 space-y-3" style={{ borderColor: '#d4b896' }}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold" style={{ color: '#2c1810' }}>Boarding &amp; other fees</h2>
        <div className="flex gap-2">
          {fees.length === 0 && (
            <button
              onClick={seedDefaults}
              className="text-xs px-3 py-1.5 rounded border hover:bg-amber-50"
              style={{ borderColor: '#d4b896', color: '#8b4513' }}
            >
              Seed common fees
            </button>
          )}
          {!showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              className="text-xs px-3 py-1.5 rounded border hover:bg-amber-50"
              style={{ borderColor: '#d4b896', color: '#8b4513' }}
            >
              + Add fee
            </button>
          )}
        </div>
      </div>
      <p className="text-xs" style={{ color: '#8b7355' }}>
        Stalls, campsites, shavings, late entry, cross-entry surcharges, etc.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {fees.length === 0 ? (
        <p className="text-sm italic" style={{ color: '#8b7355' }}>
          No boarding fees yet. Use &ldquo;Seed common fees&rdquo; to start with a typical set.
        </p>
      ) : (
        <ul className="divide-y" style={{ borderColor: '#e8d5b7' }}>
          {fees.map((fee) => {
            const draft = drafts[fee.id] ?? draftFromFee(fee);
            const reservedCount = fee.reserved_count ?? 0;
            const cents = centsFromDollars(draft.amount);
            const invalid = cents === null;
            const early = earlyFields(draft, cents ?? 0);
            const earlyChanged =
              !('error' in early) &&
              (early.early_amount_cents !== fee.early_amount_cents ||
                (early.early_deadline ?? null) !== fee.early_deadline);
            const dirty =
              !invalid &&
              (cents !== fee.amount_cents ||
                draft.label !== fee.label ||
                draft.unit !== fee.unit ||
                'error' in early ||
                earlyChanged ||
                minQuantityOf(draft) !== (fee.min_quantity ?? 0));
            return (
              <li key={fee.id} className="py-2">
              <div className="flex items-center flex-wrap gap-2">
                <input
                  value={draft.label}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [fee.id]: { ...draft, label: e.target.value } }))}
                  className="flex-1 min-w-[140px] border rounded px-2 py-1 text-sm"
                  style={{ borderColor: '#d4b896' }}
                />
                <div className="relative w-24">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: '#8b7355' }}>$</span>
                  <input
                    inputMode="decimal"
                    value={draft.amount}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [fee.id]: { ...draft, amount: e.target.value } }))}
                    className="w-full border rounded pl-5 pr-2 py-1 text-sm"
                    style={{ borderColor: invalid ? '#fca5a5' : '#d4b896' }}
                  />
                </div>
                {/* Locked once anybody has booked against this row. A booked
                    quantity means nothing apart from its unit — 3 nights and 3
                    spots are the same number and a different bill — so the
                    backend returns 409 rather than repricing them. Disabled
                    here so the secretary is told before typing, not after. */}
                <select
                  value={draft.unit}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [fee.id]: { ...draft, unit: e.target.value as Unit } }))}
                  disabled={reservedCount > 0}
                  title={
                    reservedCount > 0
                      ? `${reservedCount} exhibitor${reservedCount === 1 ? ' has' : 's have'} reserved this as "${UNIT_LABELS[fee.unit]}". Remove the fee and add it again to change how it's charged.`
                      : undefined
                  }
                  className="border rounded px-2 py-1 text-sm disabled:opacity-50"
                  style={{ borderColor: '#d4b896' }}
                >
                  {BOARDING_UNIT_OPTIONS.map((u) => (
                    <option key={u} value={u}>{UNIT_LABELS[u]}</option>
                  ))}
                </select>
                {reservedCount > 0 && (
                  <span className="text-xs" style={{ color: '#8b7355' }}>
                    {reservedCount} reserved
                  </span>
                )}
                <button
                  onClick={() => saveRow(fee)}
                  disabled={busyId === fee.id || invalid || !dirty}
                  className="text-xs px-2 py-1 rounded font-medium disabled:opacity-40"
                  style={{ color: '#8b4513' }}
                >
                  {busyId === fee.id ? '…' : 'Save'}
                </button>
                {confirmDeleteId === fee.id ? (
                  <span className="flex items-center gap-1 text-xs">
                    {/* Removing a fee cascades its reservations away (migration
                        088). That is the right behaviour — a quantity against a
                        price that no longer exists cannot be billed — but it is
                        also the route the unit-change error sends staff down,
                        so say the number out loud before they take it. */}
                    <span style={{ color: '#5c3d1e' }}>
                      {reservedCount > 0
                        ? `Remove? ${reservedCount} exhibitor reservation${reservedCount === 1 ? '' : 's'} will be dropped.`
                        : 'Remove?'}
                    </span>
                    <button onClick={() => removeRow(fee)} className="text-red-600 hover:underline" disabled={busyId === fee.id}>Yes</button>
                    <button onClick={() => setConfirmDeleteId(null)} className="hover:underline" style={{ color: '#8b7355' }}>Cancel</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmDeleteId(fee.id)} className="text-xs text-red-600 hover:underline">
                    Remove
                  </button>
                )}
              </div>
              {RESERVABLE_UNITS.has(draft.unit) && (
                <div className="flex items-center flex-wrap gap-2 mt-1.5 pl-1">
                  <span className="text-xs" style={{ color: '#8b7355' }}>
                    Early rate
                  </span>
                  <div className="relative w-24">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: '#8b7355' }}>$</span>
                    <input
                      inputMode="decimal"
                      placeholder="0.00"
                      value={draft.early}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [fee.id]: { ...draft, early: e.target.value } }))}
                      className="w-full border rounded pl-5 pr-2 py-1 text-sm"
                      style={{ borderColor: '#d4b896' }}
                      aria-label={`Early rate for ${fee.label}`}
                    />
                  </div>
                  <span className="text-xs" style={{ color: '#8b7355' }}>
                    if reserved by
                  </span>
                  <input
                    type="date"
                    value={draft.earlyDeadline}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [fee.id]: { ...draft, earlyDeadline: e.target.value } }))}
                    className="border rounded px-2 py-1 text-sm"
                    style={{ borderColor: '#d4b896' }}
                    aria-label={`Early rate deadline for ${fee.label}`}
                  />
                  {'error' in early && (
                    <span className="text-xs text-red-600">{early.error}</span>
                  )}
                  {/* Beside the early rate because they are nearly the same
                      kind of thing — but not on the same set of units. An early
                      rate applies wherever a quantity is booked; a minimum is a
                      policy the show imposes on everybody, which is stalls and
                      bedding and not camping. The backend refuses one on any
                      other unit. */}
                  {REQUIRABLE_UNITS.has(draft.unit) && (
                    <>
                      <span className="text-xs" style={{ color: '#8b7355' }}>
                        · minimum
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={999}
                        placeholder="none"
                        value={draft.minQuantity}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [fee.id]: { ...draft, minQuantity: e.target.value } }))}
                        className="w-20 border rounded px-2 py-1 text-sm"
                        style={{ borderColor: '#d4b896' }}
                        aria-label={`Minimum quantity for ${fee.label}`}
                        title="The fewest an exhibitor may reserve once they reserve any of this line. Blank means no minimum."
                      />
                    </>
                  )}
                </div>
              )}
              </li>
            );
          })}
        </ul>
      )}
      {showAddForm && (
        <div className="rounded border p-3 space-y-2" style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0' }}>
          <p className="text-xs font-semibold" style={{ color: '#2c1810' }}>New boarding fee</p>
          <div className="flex flex-wrap gap-2 items-end">
            <input
              placeholder="Label (e.g. Tack stall)"
              value={newRow.label}
              onChange={(e) => setNewRow((p) => ({ ...p, label: e.target.value }))}
              className="flex-1 min-w-[160px] border rounded px-2 py-1 text-sm"
              style={{ borderColor: '#d4b896' }}
            />
            <div className="relative w-24">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: '#8b7355' }}>$</span>
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={newRow.amount}
                onChange={(e) => setNewRow((p) => ({ ...p, amount: e.target.value }))}
                className="w-full border rounded pl-5 pr-2 py-1 text-sm"
                style={{ borderColor: '#d4b896' }}
              />
            </div>
            <select
              value={newRow.unit}
              onChange={(e) => setNewRow((p) => ({ ...p, unit: e.target.value as Unit }))}
              className="border rounded px-2 py-1 text-sm"
              style={{ borderColor: '#d4b896' }}
            >
              {BOARDING_UNIT_OPTIONS.map((u) => (
                <option key={u} value={u}>{UNIT_LABELS[u]}</option>
              ))}
            </select>
            <button
              onClick={addNew}
              disabled={adding}
              className="px-3 py-1.5 text-sm rounded font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: '#8b4513' }}
            >
              {adding ? 'Adding…' : 'Add'}
            </button>
            <button
              onClick={() => { setShowAddForm(false); setNewRow({ code: '', label: '', amount: '', unit: 'per_stall', early: '', earlyDeadline: '', minQuantity: '' }); }}
              className="text-xs hover:underline"
              style={{ color: '#8b7355' }}
            >
              Cancel
            </button>
          </div>
          {RESERVABLE_UNITS.has(newRow.unit) && (
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs" style={{ color: '#8b7355' }}>Early rate (optional)</span>
              <div className="relative w-24">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: '#8b7355' }}>$</span>
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={newRow.early}
                  onChange={(e) => setNewRow((p) => ({ ...p, early: e.target.value }))}
                  className="w-full border rounded pl-5 pr-2 py-1 text-sm"
                  style={{ borderColor: '#d4b896' }}
                  aria-label="Early rate for the new fee"
                />
              </div>
              <span className="text-xs" style={{ color: '#8b7355' }}>if reserved by</span>
              <input
                type="date"
                value={newRow.earlyDeadline}
                onChange={(e) => setNewRow((p) => ({ ...p, earlyDeadline: e.target.value }))}
                className="border rounded px-2 py-1 text-sm"
                style={{ borderColor: '#d4b896' }}
                aria-label="Early rate deadline for the new fee"
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
