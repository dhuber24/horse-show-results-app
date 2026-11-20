'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRegisterStepAutosave } from '../_lib/StepAutosave';
import { canHaveEarlyRate } from '@/lib/fee-units';
import { errorMessage } from '@/lib/api-error';
import { timeForDay } from '@/lib/default-time';
import type { StallKind, StallPeriod } from '@/lib/stall-periods';
import {
  COLORS,
  NOTES_MAX,
  PRICE_COLS,
  centsToDollars,
  dollarsToCents,
  earlyFields,
  oneParagraph,
} from './fields';
import { StallsCard, useStallsEditor } from './StallsCard';
import { OptionListCard, useOptionListEditor, type OptionListConfig } from './OptionListCard';
import { campingCode, isCampingOption } from '@/lib/camping';
import { isPermit, permitCode } from '@/lib/permits';

// Camping and the electrical hook-up were two slots — one per_night, one
// per_show — then one line with three ways to price it (migrations 108, 111).
// A show can sell more than one: WSCA's Champ Show sells electrical for the
// full show, Wednesday to Friday, and Friday to Monday, each at its own price.
// So it is a list, each option named by the office (`lib/camping.ts`).
const CAMPING: OptionListConfig = {
  id: 'camping',
  heading: 'Camping / electrical hook-up',
  blurb:
    'Each option exhibitors can book, at its own price — one for the whole show, or one for each part of it ' +
    '(Full show, Wed–Fri, Fri–Mon). Per night or per day is charged for each one booked: a Friday-to-Sunday ' +
    'show is three days and two nights.',
  belongs: isCampingOption,
  units: [
    { value: 'per_show', choice: 'One price per spot', noun: 'spot' },
    { value: 'per_night', choice: 'Per night', noun: 'night' },
    { value: 'per_day', choice: 'Per day', noun: 'day' },
  ],
  codeFor: campingCode,
  early: true,
  noun: 'camping option',
  namePlaceholder: 'e.g. Full show electrical (Wed–Mon)',
  pricePlaceholder: 'e.g. 100.00',
  notesPlaceholder: 'e.g. Electric included; spots are requested, not guaranteed',
};

// Parking and other permits (`lib/permits.ts`).
const PERMITS: OptionListConfig = {
  id: 'permits',
  heading: 'Parking & permits',
  blurb:
    'A parking permit and any other permit the show sells, such as a side-by-side or an additional vehicle. ' +
    'Exhibitors book how many they need when they register.',
  belongs: isPermit,
  units: [
    { value: 'per_show', choice: 'Per permit', noun: 'permit' },
    { value: 'per_day', choice: 'Per day', noun: 'day' },
  ],
  codeFor: permitCode,
  early: true,
  noun: 'permit',
  namePlaceholder: 'e.g. Side-by-side permit',
  pricePlaceholder: 'e.g. 20.00',
  notesPlaceholder: 'e.g. Must be displayed on the dash. One per vehicle.',
  starter: { label: 'Parking permit', button: '+ Add a parking permit', matches: /park/i },
};

export type FeeRow = {
  id: string;
  code: string;
  label: string;
  amount_cents: number;
  unit: string;
  notes: string | null;
  early_amount_cents: number | null;
  early_deadline: string | null;
  /** HH:MM(:SS) on the deadline day (migration 190), or null for no hour. */
  early_deadline_time?: string | null;
  /** The fewest an exhibitor may reserve once they reserve any (migration
   *  128). 0 means no floor, which is every show that has not said otherwise. */
  min_quantity?: number;
  /** How many exhibitors have already booked this line. Staff endpoint only. */
  reserved_count?: number;
  /** On a stall line (migration 194): what it sells, stated or read from the
   *  line by the backend; the period it is sold for; a tack stall's minimum. */
  stall_kind?: StallKind | null;
  stall_period_id?: string | null;
  horses_per_tack_stall?: number | null;
  /** When holders may move in (migration 195): the Early Move-In Pass's own
   *  day (yyyy-mm-dd) and optional hour, venue wall-clock. */
  move_in_date?: string | null;
  move_in_time?: string | null;
  /** When that window closes (migration 203). */
  move_in_end_date?: string | null;
  move_in_end_time?: string | null;
};

/** What is typed on a slot's card. The row it saves to is not held here: the
 *  save reads it off `initialFees` (`findFee`), which `router.refresh()`
 *  replaces after every save while this state stays as it was. */
type SlotState = {
  reservedCount: number;
  unit: string;
  dollars: string;
  notes: string;
  /** Early-bird rate. Both fields or neither — the backend rejects a half-set
   *  pair rather than storing a discount that would never fire. */
  earlyDollars: string;
  earlyDeadline: string;
  /** HH:MM on the deadline day, or '' for no hour. Printed as typed, local to
   *  the venue; the rate itself still turns on the day. */
  earlyDeadlineTime: string;
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
   *  no sensible answer under either, and a floor required of everybody read as
   *  nonsense against them. `POST/PATCH /shows/{id}/fees` refuses a minimum on
   *  anything but bedding for the same reason. */
  requirable: boolean;
  notesPlaceholder: string;
};

// Stalls are not a slot: every line priced per stall is the Stalls card's
// (`StallsCard.tsx`, migration 194), found by unit rather than by code. Nor are
// camping and permits: a show sells several of each, each its own line
// (`OptionListCard`, below).
const SLOTS: readonly Slot[] = [
  {
    code: 'shavings',
    aliases: [],
    title: 'Shavings',
    createLabel: 'Shavings (per bag)',
    units: [{ value: 'per_bag', choice: 'Per bag', noun: 'bag', placeholder: 'e.g. 10.00' }],
    requirable: true,
    notesPlaceholder: '',
  },
];

/** Whether any unit this slot offers may carry an early rate. A slot with
 *  several units (camping) qualifies if any of them do; shavings has exactly
 *  one unit and it does not. */
function earlyRateAllowed(slot: Slot): boolean {
  return slot.units.some((u) => canHaveEarlyRate(u.value));
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

export default function LodgingClient({
  showId,
  initialFees,
  initialShavingsBanOutside,
  initialStallsOpenDate,
  initialStallsOpenTime,
  showStartDate,
  showEndDate,
  maps,
  initialStallPeriods,
  initialStallPerHorse,
  allFeeCodes,
}: {
  showId: string;
  initialFees: FeeRow[];
  /** The windows stall lines are sold for (migration 194). */
  initialStallPeriods: StallPeriod[];
  /** Every horse entered needs its own stall (migration 194). */
  initialStallPerHorse: boolean;
  /** Every fee code on the show, so a new stall line's code is unique. */
  allFeeCodes: string[];
  initialShavingsBanOutside: boolean;
  /** `shows.stalls_open_*` as saved (migration 181): yyyy-mm-dd and HH:MM, or
   *  ''. Set from the stall periods, never typed here; a show still carrying
   *  one from before periods opens on a period made from it (`StallsCard`). */
  initialStallsOpenDate: string;
  initialStallsOpenTime: string;
  showStartDate: string;
  showEndDate: string;
  /** The stall and RV map uploads, drawn under *Stalls & move-in*. They save
   *  on their own, so they are handed in rather than joining this form's save. */
  maps?: React.ReactNode;
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
        earlyDeadlineTime: (fee?.early_deadline_time ?? '').slice(0, 5),
        minQuantity: fee?.min_quantity ? String(fee.min_quantity) : '',
      };
    }
    return base;
  });

  const [banOutsideShavings, setBanOutsideShavings] = useState(initialShavingsBanOutside);
  // The *Stalls & move-in* card (`StallsCard`): the stall periods — the only
  // place move-in is set — each with its own Early Move-In Pass, every line
  // priced per stall, and the stall-per-horse tick (migrations 194-196). Its
  // save runs inside this one.
  const stalls = useStallsEditor({
    showId,
    fees: initialFees,
    periods: initialStallPeriods,
    stallPerHorse: initialStallPerHorse,
    takenCodes: allFeeCodes,
    showStartDate,
    showEndDate,
    stallsOpenDateOnFile: initialStallsOpenDate,
    stallsOpenTimeOnFile: initialStallsOpenTime,
  });

  // The *Camping* and *Parking & permits* cards (`OptionListCard`): each a
  // list of options the office names. Their saves run inside this one too.
  const camping = useOptionListEditor(CAMPING, { showId, fees: initialFees, takenCodes: allFeeCodes });
  const permits = useOptionListEditor(PERMITS, { showId, fees: initialFees, takenCodes: allFeeCodes });

  function setSlot(code: string, patch: Partial<SlotState>) {
    setSlots((prev) => ({ ...prev, [code]: { ...prev[code], ...patch } }));
  }

  /** Whether anything on the screen differs from what is on file. Compared
   *  against the rows this screen loaded rather than tracked as a flag: a
   *  manager who types a 5 and deletes it again has changed nothing, and the
   *  autosave firing on every step link must not rewrite the step for them. */
  const dirty = SLOTS.some((s) => {
    const slot = slots[s.code];
    const fee = findFee(s);
    const onFile = fee ? centsToDollars(fee.amount_cents) : '';
    return (
      slot.dollars.trim() !== onFile.trim() ||
      slot.notes !== (fee?.notes ?? '') ||
      slot.unit !== (fee ? fee.unit : s.units[0].value) ||
      slot.earlyDollars !==
        (fee?.early_amount_cents != null ? centsToDollars(fee.early_amount_cents) : '') ||
      slot.earlyDeadline !== (fee?.early_deadline ?? '') ||
      slot.earlyDeadlineTime !== (fee?.early_deadline_time ?? '').slice(0, 5) ||
      slot.minQuantity !== (fee?.min_quantity ? String(fee.min_quantity) : '')
    );
  }) ||
    banOutsideShavings !== initialShavingsBanOutside ||
    stalls.dirty ||
    camping.dirty ||
    permits.dirty;

  /** Returns whether everything was written. The step's autosave stops the
   *  navigation on a false — the row that failed has said why on screen, and
   *  carrying the manager forward from it is the silent loss this replaces. */
  async function save(): Promise<boolean> {
    setError(null);
    setSuccessMsg(null);
    setBusy(true);
    try {
      // 1) Patch the show's own columns: the shavings policy and the stall-per-
      //    horse tick. Only what changed is sent. When stalls open is not one
      //    of them — the backend sets it from the stall periods, which also
      //    carry the move-in notes (step 2).
      const showPatch: Record<string, unknown> = {};
      if (banOutsideShavings !== initialShavingsBanOutside) {
        showPatch.shavings_ban_outside = banOutsideShavings;
      }
      if (stalls.perHorse !== initialStallPerHorse) {
        showPatch.stall_per_horse_required = stalls.perHorse;
      }
      if (Object.keys(showPatch).length > 0) {
        const showRes = await fetch(`/api/shows/${showId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(showPatch),
        });
        if (!showRes.ok) {
          const j = await showRes.json().catch(() => null);
          setError(errorMessage(j, 'Failed to update the stall and shavings settings.'));
          return false;
        }
      }

      // 2) The stall periods, every stall line and each move-in's pass
      //    (`StallsCard`).
      if (stalls.dirty && !(await stalls.save((message) => setError(message)))) {
        return false;
      }

      // 3) Upsert / delete the shavings slot.
      for (const s of SLOTS) {
        const slot = slots[s.code];
        const cents = dollarsToCents(slot.dollars);
        const isEmpty = slot.dollars.trim() === '';
        // The row as it is on file now. Read off the props rather than kept in
        // state from the first render: a second save from the same page used
        // to post the row the first save had already created, and bill every
        // exhibitor two stalls. The row's code is normalised (an older
        // `hookup` becomes `camping`), and `unit` is sent only when the manager
        // picked a different one.
        const onFile = findFee(s);

        // Caught here as well as server-side so the secretary sees which row
        // is wrong, rather than a bare 422 on "save".
        const early = earlyFields(slot, cents);
        if ('error' in early) {
          setError(`${s.title}: ${early.error}`);
          return false;
        }

        if (onFile && isEmpty) {
          // remove
          const res = await fetch(`/api/shows/${showId}/fees/${onFile.id}`, {
            method: 'DELETE',
          });
          if (!res.ok && res.status !== 204) {
            const j = await res.json().catch(() => null);
            setError(errorMessage(j, `Failed to remove ${s.title}.`));
            return false;
          }
        } else if (onFile && !isEmpty) {
          const res = await fetch(`/api/shows/${showId}/fees/${onFile.id}`, {
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
              ...(unitIsManaged(s, slot.unit) && slot.unit !== onFile.unit
                ? { unit: slot.unit }
                : {}),
              ...(onFile.code !== s.code ? { code: s.code } : {}),
              min_quantity: minQuantityOf(s, slot),
              ...early,
            }),
          });
          if (!res.ok) {
            const j = await res.json().catch(() => null);
            setError(errorMessage(j, `Failed to update ${s.title}.`));
            return false;
          }
        } else if (!onFile && !isEmpty) {
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
            setError(errorMessage(j, `Failed to create ${s.title}.`));
            return false;
          }
        }
      }

      // 4) Camping options, and parking and other permits (`OptionListCard`).
      for (const list of [camping, permits]) {
        if (list.dirty && !(await list.save((message) => setError(message)))) return false;
      }

      setSuccessMsg('Lodging & boarding saved.');
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  // Leaving the step saves it. Every slot is written from the same state the
  // Save button reads, so this is that button pressed on the way out — and it
  // is a no-op in the one case that matters, a manager passing through a step
  // they have not touched, because each slot's write is skipped when the
  // amount is unchanged and empty.
  useRegisterStepAutosave(
    async () => {
      if (!dirty) return;
      if (!(await save())) throw new Error('Lodging & boarding could not be saved.');
    },
    () => dirty,
  );

  return (
    <div className="space-y-6">
      {error && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--error)', backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}
          role="alert"
        >
          {error}
        </div>
      )}
      {successMsg && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--success-border)', backgroundColor: 'var(--success-bg)', color: 'var(--success-strong)' }}
        >
          {successMsg}
        </div>
      )}

      {/* A card per line, each under its own heading. All three ran together
          in one box, separated only by a small grey label above each unit
          picker — so a note typed against camping read as though it applied to
          the shavings above it, and the shavings ban looked like a policy about
          the whole step. A section apiece is what makes the controls in a box
          belong to the thing the box is named after. */}
      {/* Stalls and move-in first: when the barn opens is the one thing on this
          step every exhibitor hauling in needs, and each stall period is its
          own move-in, so the two are one card. */}
      <StallsCard editor={stalls} />

      {maps}

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
        const notesLeft = NOTES_MAX - slot.notes.length;
        return (
          <section
            key={s.code}
            className="p-4 rounded-lg border space-y-4"
            style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
          >
            {/* How a one-unit line is charged is a fact, not a choice, so it
                rides under the heading. It used to fill a column of its own
                beside the price — a label and three words of text holding a
                third of the card's width open on a wide screen. */}
            <div>
              <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
                {s.title}
              </h2>
              {/* What was read off the show bill about this line (migration 187). */}
              {!managed ? (
                <p className="text-xs mt-0.5" style={{ color: COLORS.muted }}>
                  Charged {slot.unit.replace(/_/g, ' ')}{' '}
                  <a
                    href={`/admin/shows/${showId}/fees/boarding`}
                    className="underline"
                    style={{ color: COLORS.muted }}
                  >
                    (set on the boarding fee schedule)
                  </a>
                </p>
              ) : s.units.length === 1 ? (
                <p className="text-xs mt-0.5" style={{ color: COLORS.muted }}>
                  Charged per {chosen.noun}
                </p>
              ) : null}
            </div>

            {managed && s.units.length > 1 && (
              <div>
                <fieldset
                  title={lockReason}
                  disabled={unitLocked}
                  style={{ opacity: unitLocked ? 0.55 : 1 }}
                >
                  <legend className="block text-xs mb-1" style={{ color: COLORS.muted }}>
                    How it&apos;s charged
                  </legend>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
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
                  </div>
                </fieldset>
                <p className="text-xs mt-1" style={{ color: COLORS.muted }}>
                  {slot.unit === 'per_show'
                    ? `Charged once per ${chosen.noun} however long the show runs — two spots cost twice, a three-day show does not.`
                    : `Charged for each ${chosen.noun} an exhibitor books — a Friday-to-Sunday show is three days and two nights.`}
                  {unitLocked && <> {lockReason}</>}
                </p>
              </div>
            )}

            {/* Prices on the left, the note on the right. The note is the
                longest thing a secretary types on this step — a stall policy
                pasted off the show bill runs to a paragraph — and it was a
                one-line box, so all but its first sentence was out of sight. */}
            <div className="grid gap-x-6 gap-y-4 md:grid-cols-[22rem_minmax(0,1fr)]">
              <div className="space-y-4">
                <div className={`${PRICE_COLS} items-end`}>
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
                  {/* The floor an exhibitor cannot book under. It belongs
                      beside the shavings ban most of all: banning outside
                      shavings tells the exhibitor to buy bedding here, and
                      "buy some" with no number is a stall bedded with two bags
                      where the show wanted four.

                      Bedding only. A minimum states a fact about the grounds —
                      "every stall gets bedded this deep" — and neither a stall
                      count nor a camping spot is that: an exhibitor books
                      however many of either they need, so a floor required of
                      everybody read as nonsense against either line. */}
                  {s.requirable && (
                    <label
                      className="block"
                      title={
                        'A flat floor on the whole booking, not a number multiplied by the ' +
                        'stalls reserved. A show wanting "2 bags per stall" sets the flat ' +
                        'equivalent here and says so in Notes. Leave blank to require none — ' +
                        'though banning outside shavings already requires one bag of anyone ' +
                        'who books a stall.'
                      }
                    >
                      <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
                        Minimum bags per exhibitor
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
                    </label>
                  )}
                </div>

                {/* Not offered on shavings. Every other reservable line has a
                    real reserve-early convention on a paper show bill — book a
                    stall or a camping spot by a date, pay less. A bag count has
                    no such convention; the control used to sit here anyway, a
                    box with nothing behind it for a secretary to fill in. */}
                {earlyRateAllowed(s) && (
                  <div role="group" aria-label={`${s.title} — early rate`}>
                    <p className="text-xs mb-1.5" style={{ color: COLORS.text }}>
                      Early rate{' '}
                      <span style={{ color: 'var(--text-dimmed)' }}>
                        (optional — cheaper if they reserve by the date)
                      </span>
                    </p>
                    <div className={`${PRICE_COLS} items-end`}>
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
                      <div>
                        <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
                          Reserve by
                        </span>
                        {/* The hour is optional and printed as typed, local to
                            the venue (migration 190). Which rate a booking
                            pays still turns on the day. */}
                        <div className="flex flex-wrap gap-2">
                          <input
                            type="date"
                            value={slot.earlyDeadline}
                            onChange={(e) =>
                              setSlot(s.code, {
                                earlyDeadline: e.target.value,
                                // Noon when the day is picked with no hour, as
                                // every time field; clearing the day clears it.
                                earlyDeadlineTime: timeForDay(e.target.value, slot.earlyDeadlineTime),
                              })
                            }
                            className="min-w-[9.5rem] flex-1 border rounded px-3 py-2"
                            style={{ borderColor: COLORS.border }}
                            aria-label={`${s.title} — early rate deadline`}
                          />
                          <input
                            type="time"
                            value={slot.earlyDeadlineTime}
                            disabled={!slot.earlyDeadline}
                            title={slot.earlyDeadline ? 'Optional' : 'Pick the reserve-by date first.'}
                            onChange={(e) => setSlot(s.code, { earlyDeadlineTime: e.target.value })}
                            className="w-32 border rounded px-3 py-2 disabled:opacity-50"
                            style={{ borderColor: COLORS.border }}
                            aria-label={`${s.title} — early rate deadline time`}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Grows with what is typed (`field-sizing`), and stretches to
                  the height of the prices beside it so a short note does not
                  leave a hole under its box. A browser without field-sizing
                  shows three lines and a drag handle. */}
              <label className="flex flex-col">
                <span
                  className="flex justify-between gap-2 text-xs mb-1"
                  style={{ color: COLORS.muted }}
                >
                  <span>Notes (optional)</span>
                  {notesLeft <= 100 && <span>{notesLeft} characters left</span>}
                </span>
                <textarea
                  rows={3}
                  maxLength={NOTES_MAX}
                  value={slot.notes}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.preventDefault();
                  }}
                  onChange={(e) => setSlot(s.code, { notes: oneParagraph(e.target.value) })}
                  className="w-full flex-1 min-h-[5.75rem] border rounded px-3 py-2 resize-y"
                  style={{ borderColor: COLORS.border, fieldSizing: 'content' }}
                  placeholder={s.notesPlaceholder}
                  aria-label={`${s.title} — notes`}
                />
              </label>
            </div>

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
          </section>
        );
      })}

      <OptionListCard editor={camping} />
      <OptionListCard editor={permits} />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="text-sm rounded px-4 py-2 disabled:opacity-50"
          style={{ backgroundColor: COLORS.warn, color: 'var(--surface)' }}
        >
          {busy ? 'Saving…' : 'Save lodging & boarding'}
        </button>
      </div>
    </div>
  );
}
