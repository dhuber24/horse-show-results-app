'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { canHaveEarlyRate } from '@/lib/fee-units';

export type FeeRow = {
  id: string;
  code: string;
  label: string;
  amount_cents: number;
  unit: string;
  notes: string | null;
  early_amount_cents: number | null;
  early_deadline: string | null;
  /** The fewest an exhibitor may reserve once they reserve any (migration
   *  128). 0 means no floor, which is every show that has not said otherwise. */
  min_quantity?: number;
  /** How many exhibitors have already booked this line. Staff endpoint only. */
  reserved_count?: number;
};

const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  border: '#d4b896',
  bg: '#fff',
  warn: '#5c3d1e',
  warnSoft: '#fdf8eb',
} as const;

type SlotState = {
  feeId: string | null;
  /** The code the loaded row actually carries, so an older `hookup` row is
   *  normalised to `camping` on save rather than left behind. */
  feeCode: string | null;
  /** The unit the loaded row carries, so a save only sends `unit` when the
   *  manager actually changed it. */
  feeUnit: string | null;
  reservedCount: number;
  unit: string;
  dollars: string;
  notes: string;
  /** Early-bird rate. Both fields or neither — the backend rejects a half-set
   *  pair rather than storing a discount that would never fire. */
  earlyDollars: string;
  earlyDeadline: string;
  /** The show's minimum, as typed. Blank and "0" both mean no floor. */
  minQuantity: string;
};

type UnitChoice = {
  value: string;
  /** How the manager picks it: the charging shape, not the unit name. */
  choice: string;
  /** What the exhibitor books one of. Not always the tail of the unit — a
   *  per_show fee reads "cost per show" if you derive it, when what is being
   *  priced is one spot for however long the show runs. */
  noun: string;
  placeholder: string;
};

type Slot = {
  code: string;
  /** Codes an earlier version of this screen may have written for the same
   *  line. Migration 108 folded `hookup` into `camping`; this is what stops a
   *  row that somehow escaped it from being billed alongside a new one. */
  aliases: readonly string[];
  /** Heading, and the name used in save errors. */
  title: string;
  /** Label written on the fee row when this screen creates it. The exhibitor
   *  and the printed show bill read this, so it never names a unit that the
   *  manager is free to change. */
  createLabel: string;
  units: readonly UnitChoice[];
  /** Whether this line is one the show can require of everybody.
   *
   *  Bedding is the only one: "we will not have horses bedded on less than
   *  this" is a real venue policy. Stalls and camping are not — an exhibitor
   *  books however many stalls they need, and nobody makes an exhibitor book
   *  a camping spot to be allowed to enter — so the box asked a question with
   *  no sensible answer and its own explanation ("required of everyone who
   *  signs up") read as nonsense under either. `POST/PATCH /shows/{id}/fees`
   *  refuses a minimum on anything but bedding for the same reason. */
  requirable: boolean;
  notesPlaceholder: string;
};

const SLOTS: readonly Slot[] = [
  {
    code: 'stall',
    aliases: [],
    title: 'Stalls',
    createLabel: 'Stall (per stall)',
    units: [
      { value: 'per_stall', choice: 'Per stall', noun: 'stall', placeholder: 'e.g. 75.00' },
    ],
    requirable: false,
    notesPlaceholder: '',
  },
  {
    code: 'shavings',
    aliases: [],
    title: 'Shavings',
    createLabel: 'Shavings (per bag)',
    units: [{ value: 'per_bag', choice: 'Per bag', noun: 'bag', placeholder: 'e.g. 10.00' }],
    requirable: true,
    notesPlaceholder: '',
  },
  {
    // Camping and the electrical hook-up were two slots — one per_night, one
    // per_show — and that asked the manager which product the venue sells when
    // the only real question is how they charge for the one spot. A manager
    // who filled in both put two camping charges on the same bill with nothing
    // to say so. One line, three ways to price it (migrations 108, 111): by
    // the night, by the day, or one price for the whole show.
    code: 'camping',
    aliases: ['hookup'],
    title: 'Camping / electrical hook-up',
    createLabel: 'Camping / electrical hook-up',
    units: [
      {
        value: 'per_night',
        choice: 'Per night',
        noun: 'night',
        placeholder: 'e.g. 30.00',
      },
      {
        value: 'per_day',
        choice: 'Per day',
        noun: 'day',
        placeholder: 'e.g. 30.00',
      },
      {
        value: 'per_show',
        choice: 'One price for the whole show',
        noun: 'spot',
        placeholder: 'e.g. 60.00',
      },
    ],
    requirable: false,
    notesPlaceholder: 'e.g. Electric included; spots are requested, not guaranteed',
  },
];

/** Whether any unit this slot offers may carry an early rate. A slot with
 *  several units (camping) qualifies if any of them do; shavings has exactly
 *  one unit and it does not. */
function earlyRateAllowed(slot: Slot): boolean {
  return slot.units.some((u) => canHaveEarlyRate(u.value));
}

function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function dollarsToCents(input: string): number {
  const n = Number.parseFloat(input);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function unitChoice(slot: Slot, unit: string): UnitChoice {
  return slot.units.find((u) => u.value === unit) ?? slot.units[0];
}

/** The floor as a number the backend will take. Blank, zero and anything that
 *  is not a whole number all mean "no minimum" — a show that has not answered
 *  the question must not end up with one.
 *
 *  A slot that cannot be required always sends 0, which is also how a stray
 *  value left on a camping row by an older version of this screen gets cleared
 *  rather than sitting there refusing sign-ups from a box nothing renders. */
function minQuantityOf(slot: Slot, state: SlotState): number {
  if (!slot.requirable) return 0;
  const n = Number.parseInt(state.minQuantity, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 999) : 0;
}

/** Whether this screen is able to speak for the row's current unit. False when
 *  the secretary priced it on the full boarding schedule as something these
 *  slots don't offer — `flat` camping, say. Rewriting that to the slot default
 *  on the next save would be this screen changing a price it was never shown. */
function unitIsManaged(slot: Slot, unit: string): boolean {
  return slot.units.some((u) => u.value === unit);
}

type EarlyFields = { early_amount_cents: number | null; early_deadline: string | null };

/** The early-bird half of a slot's payload, or the reason it can't be sent. */
function earlyFields(slot: SlotState, standardCents: number): EarlyFields | { error: string } {
  const hasAmount = slot.earlyDollars.trim() !== '';
  const hasDeadline = slot.earlyDeadline.trim() !== '';
  if (!hasAmount && !hasDeadline) {
    return { early_amount_cents: null, early_deadline: null };
  }
  if (hasAmount !== hasDeadline) {
    return {
      error: 'an early rate needs both a discounted amount and a "reserve by" date.',
    };
  }
  const earlyCents = dollarsToCents(slot.earlyDollars);
  if (earlyCents > standardCents) {
    return { error: 'the early rate must be lower than the standard rate.' };
  }
  return { early_amount_cents: earlyCents, early_deadline: slot.earlyDeadline };
}

export default function LodgingClient({
  showId,
  initialFees,
  initialShavingsBanOutside,
}: {
  showId: string;
  initialFees: FeeRow[];
  initialShavingsBanOutside: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  /** The row this slot manages: its own code first, then any code an earlier
   *  version wrote for the same line. */
  function findFee(slot: Slot): FeeRow | undefined {
    for (const code of [slot.code, ...slot.aliases]) {
      const fee = initialFees.find((f) => f.code === code);
      if (fee) return fee;
    }
    return undefined;
  }

  const [slots, setSlots] = useState<Record<string, SlotState>>(() => {
    const base: Record<string, SlotState> = {};
    for (const s of SLOTS) {
      const fee = findFee(s);
      base[s.code] = {
        feeId: fee?.id ?? null,
        feeCode: fee?.code ?? null,
        feeUnit: fee?.unit ?? null,
        reservedCount: fee?.reserved_count ?? 0,
        // An existing row's unit wins over the slot's default, always and
        // verbatim: it is what the exhibitors booking against it have been
        // quoted. A unit these slots don't offer is carried through unchanged
        // and shown read-only rather than snapped to the default.
        unit: fee ? fee.unit : s.units[0].value,
        dollars: fee ? centsToDollars(fee.amount_cents) : '',
        notes: fee?.notes ?? '',
        earlyDollars:
          fee?.early_amount_cents != null ? centsToDollars(fee.early_amount_cents) : '',
        earlyDeadline: fee?.early_deadline ?? '',
        minQuantity: fee?.min_quantity ? String(fee.min_quantity) : '',
      };
    }
    return base;
  });

  const [banOutsideShavings, setBanOutsideShavings] = useState(initialShavingsBanOutside);

  function setSlot(code: string, patch: Partial<SlotState>) {
    setSlots((prev) => ({ ...prev, [code]: { ...prev[code], ...patch } }));
  }

  async function save() {
    setError(null);
    setSuccessMsg(null);
    setBusy(true);
    try {
      // 1) Patch shavings_ban_outside on the show.
      if (banOutsideShavings !== initialShavingsBanOutside) {
        const showRes = await fetch(`/api/shows/${showId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shavings_ban_outside: banOutsideShavings }),
        });
        if (!showRes.ok) {
          const j = await showRes.json().catch(() => null);
          setError(j?.detail || 'Failed to update shavings policy.');
          return;
        }
      }

      // 2) Upsert / delete each lodging fee slot.
      for (const s of SLOTS) {
        const slot = slots[s.code];
        const cents = dollarsToCents(slot.dollars);
        const isEmpty = slot.dollars.trim() === '';

        // Caught here as well as server-side so the secretary sees which row
        // is wrong, rather than a bare 422 on "save".
        const early = earlyFields(slot, cents);
        if ('error' in early) {
          setError(`${s.title}: ${early.error}`);
          return;
        }

        if (slot.feeId && isEmpty) {
          // remove
          const res = await fetch(`/api/shows/${showId}/fees/${slot.feeId}`, {
            method: 'DELETE',
          });
          if (!res.ok && res.status !== 204) {
            const j = await res.json().catch(() => null);
            setError(j?.detail || `Failed to remove ${s.title}.`);
            return;
          }
        } else if (slot.feeId && !isEmpty) {
          const res = await fetch(`/api/shows/${showId}/fees/${slot.feeId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              amount_cents: cents,
              notes: slot.notes.trim() || null,
              // Only sent when the manager actually picked a different one of
              // this slot's choices. Sending it every save would make the
              // backend's unit guard look flaky in the logs, and sending it
              // for a unit this screen doesn't offer would rewrite a price
              // set elsewhere.
              ...(unitIsManaged(s, slot.unit) && slot.unit !== slot.feeUnit
                ? { unit: slot.unit }
                : {}),
              ...(slot.feeCode !== s.code ? { code: s.code } : {}),
              min_quantity: minQuantityOf(s, slot),
              ...early,
            }),
          });
          if (!res.ok) {
            const j = await res.json().catch(() => null);
            setError(j?.detail || `Failed to update ${s.title}.`);
            return;
          }
        } else if (!slot.feeId && !isEmpty) {
          const res = await fetch(`/api/shows/${showId}/fees`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code: s.code,
              label: s.createLabel,
              unit: slot.unit,
              amount_cents: cents,
              notes: slot.notes.trim() || null,
              min_quantity: minQuantityOf(s, slot),
              ...early,
            }),
          });
          if (!res.ok) {
            const j = await res.json().catch(() => null);
            setError(j?.detail || `Failed to create ${s.title}.`);
            return;
          }
        }
      }

      setSuccessMsg('Lodging & boarding saved.');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#c0392b', backgroundColor: '#fef0ef', color: '#922' }}
          role="alert"
        >
          {error}
        </div>
      )}
      {successMsg && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#7fa97f', backgroundColor: '#eef7ee', color: '#1f4e1f' }}
        >
          {successMsg}
        </div>
      )}

      <section
        className="p-4 rounded-lg border space-y-4"
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
      >
        {SLOTS.map((s) => {
          const slot = slots[s.code];
          const chosen = unitChoice(s, slot.unit);
          const managed = unitIsManaged(s, slot.unit);
          // The unit says what a booked quantity counts. Once exhibitors hold
          // reservations, changing it would reprice all of them — the backend
          // returns 409, so the choice is locked here rather than offered and
          // then refused.
          const unitLocked = slot.reservedCount > 0;
          const lockReason = unitLocked
            ? `${slot.reservedCount} exhibitor${slot.reservedCount === 1 ? ' has' : 's have'} ` +
              `already reserved this at the current rate. Remove the fee and add it again ` +
              `to change how it's charged.`
            : undefined;
          return (
            <div key={s.code} className="space-y-2">
              <div className="grid sm:grid-cols-[1fr_8rem_1fr] gap-3 items-end">
                <div>
                  <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
                    {s.title}
                  </span>
                  {!managed ? (
                    <span className="text-sm" style={{ color: COLORS.text }}>
                      Charged {slot.unit.replace(/_/g, ' ')}{' '}
                      <a
                        href={`/admin/shows/${showId}/fees/boarding`}
                        className="text-xs underline"
                        style={{ color: COLORS.muted }}
                      >
                        (set on the boarding fee schedule)
                      </a>
                    </span>
                  ) : s.units.length > 1 ? (
                    <fieldset
                      className="flex flex-wrap gap-x-4 gap-y-1"
                      title={lockReason}
                      disabled={unitLocked}
                      style={{ opacity: unitLocked ? 0.55 : 1 }}
                    >
                      <legend className="sr-only">How {s.title} is charged</legend>
                      {s.units.map((u) => (
                        <label
                          key={u.value}
                          className="flex items-center gap-1.5 text-sm"
                          style={{ color: COLORS.text }}
                        >
                          <input
                            type="radio"
                            name={`${s.code}-unit`}
                            value={u.value}
                            checked={slot.unit === u.value}
                            onChange={() => setSlot(s.code, { unit: u.value })}
                          />
                          <span>{u.choice}</span>
                        </label>
                      ))}
                    </fieldset>
                  ) : (
                    <span className="text-sm" style={{ color: COLORS.text }}>
                      Cost per {chosen.noun}
                    </span>
                  )}
                </div>
                <label className="block">
                  <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
                    {managed ? `$ per ${chosen.noun}` : 'Amount ($)'}
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={slot.dollars}
                    onChange={(e) => setSlot(s.code, { dollars: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                    style={{ borderColor: COLORS.border }}
                    placeholder={managed ? chosen.placeholder : ''}
                    aria-label={
                      managed ? `${s.title} — amount per ${chosen.noun}` : `${s.title} — amount`
                    }
                  />
                </label>
                <label className="block">
                  <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
                    Notes (optional)
                  </span>
                  <input
                    type="text"
                    value={slot.notes}
                    onChange={(e) => setSlot(s.code, { notes: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                    style={{ borderColor: COLORS.border }}
                    placeholder={s.notesPlaceholder}
                  />
                </label>
              </div>
              {s.units.length > 1 && managed && (
                <p className="text-xs" style={{ color: COLORS.muted }}>
                  {slot.unit === 'per_show'
                    ? `Charged once per ${chosen.noun} however long the show runs — two spots cost twice, a three-day show does not.`
                    : `Charged for each ${chosen.noun} an exhibitor books — a Friday-to-Sunday show is three days and two nights.`}
                  {unitLocked && <> {lockReason}</>}
                </p>
              )}
              {/* Not offered on shavings. Every other reservable line has a
                  real reserve-early convention on a paper show bill — book a
                  stall or a camping spot by a date, pay less. A bag count has
                  no such convention; the control used to sit here anyway, a
                  box with nothing behind it for a secretary to fill in. */}
              {earlyRateAllowed(s) && (
                <div className="grid sm:grid-cols-[1fr_8rem_1fr] gap-3 items-end">
                  <span className="text-xs" style={{ color: COLORS.muted }}>
                    Early rate{' '}
                    <span style={{ color: '#a08a6e' }}>
                      (optional — cheaper if they reserve by the date)
                    </span>
                  </span>
                  <label className="block">
                    <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
                      Early amount ($)
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={slot.earlyDollars}
                      onChange={(e) => setSlot(s.code, { earlyDollars: e.target.value })}
                      className="w-full border rounded px-3 py-2"
                      style={{ borderColor: COLORS.border }}
                      placeholder="e.g. 60.00"
                      aria-label={`${s.title} — early rate amount`}
                    />
                  </label>
                  <label className="block">
                    <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
                      Reserve by
                    </span>
                    <input
                      type="date"
                      value={slot.earlyDeadline}
                      onChange={(e) => setSlot(s.code, { earlyDeadline: e.target.value })}
                      className="w-full border rounded px-3 py-2"
                      style={{ borderColor: COLORS.border }}
                      aria-label={`${s.title} — early rate deadline`}
                    />
                  </label>
                </div>
              )}
              {/* The floor an exhibitor cannot book under. It belongs beside
                  the shavings ban most of all: banning outside shavings tells
                  the exhibitor to buy bedding here, and "buy some" with no
                  number is a stall bedded with two bags where the show wanted
                  four.

                  Bedding only. A minimum states a fact about the grounds —
                  "every stall gets bedded this deep" — and neither a stall
                  count nor a camping spot is that: an exhibitor books however
                  many of either they need, and asking for a floor under it was
                  a question with no sensible answer, under an explanation
                  ("required of everyone who signs up") that read as nonsense
                  against either line. */}
              {s.requirable && (
                <label className="block sm:max-w-xs">
                  <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
                    Minimum per exhibitor{' '}
                    <span style={{ color: '#a08a6e' }}>(optional)</span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={999}
                    value={slot.minQuantity}
                    onChange={(e) => setSlot(s.code, { minQuantity: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                    style={{ borderColor: COLORS.border }}
                    placeholder="no minimum"
                    aria-label={`${s.title} — minimum quantity`}
                  />
                  <span className="block text-xs mt-0.5" style={{ color: COLORS.muted }}>
                    <strong>Required of everyone who signs up</strong>, not just of people who
                    order some — that is the point of it, and it is why a sign-up with none of this
                    line is refused. Leave blank if you take day-haul entries who should not be
                    charged for it.
                  </span>
                </label>
              )}

              {s.code === 'shavings' && (
                <label
                  className="flex items-start gap-2 text-sm ml-1"
                  style={{ color: COLORS.text }}
                >
                  <input
                    type="checkbox"
                    checked={banOutsideShavings}
                    onChange={(e) => setBanOutsideShavings(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    <strong>Ban outside shavings.</strong>{' '}
                    <span style={{ color: COLORS.muted }}>
                      Exhibitors must buy shavings from the show. This shows on the
                      exhibitor&apos;s registration screen.
                    </span>
                  </span>
                </label>
              )}
            </div>
          );
        })}

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="text-sm rounded px-4 py-2 disabled:opacity-50"
            style={{ backgroundColor: COLORS.warn, color: '#fff' }}
          >
            {busy ? 'Saving…' : 'Save lodging & boarding'}
          </button>
        </div>
        <p className="text-xs" style={{ color: COLORS.muted }}>
          Leave an amount blank to skip or remove that fee. Saving is non-destructive
          to other show fees. Extra campsite tiers — dry camping, early arrival, late
          departure — live on the full{' '}
          <a
            href={`/admin/shows/${showId}/fees/boarding`}
            className="underline"
            style={{ color: COLORS.warn }}
          >
            boarding fee schedule
          </a>
          .
        </p>
      </section>
    </div>
  );
}
