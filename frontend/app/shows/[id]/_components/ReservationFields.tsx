'use client';

import { useMemo, useState } from 'react';

import type { CancellationWindow, ProfileStatus } from '../register/types';

/**
 * Stalls, shavings, camping, arrival dates and a note to the office — the whole
 * of show sign-up apart from the page it sits on.
 *
 * Extracted when the registration screen absorbed it. An exhibitor signing up
 * for a show is doing one thing, not two: reserving what they need on the
 * grounds and entering the classes they came for. Those were two screens with a
 * redirect between them, and the redirect is what made it feel like two jobs.
 * Now `/shows/[id]/register` renders this inside a collapsible section and
 * `/shows/[id]/signup` renders it as its own page, both from this component, so
 * the two cannot drift into disagreeing about a price or a quantity.
 *
 * Every rate comes from `rate_cents`, never `amount_cents`: it is what *this*
 * exhibitor is charged — their locked-in early rate if they already booked the
 * line, today's rate otherwise. Quoting the standard rate while the backend
 * bills the early one is exactly the disagreement `billing.py` exists to
 * prevent (see Claude.md).
 */

export type FeeOption = {
  id: string;
  code: string;
  label: string;
  unit: string;
  /** The standard (post-deadline) rate. */
  amount_cents: number;
  /** What *this* exhibitor is charged per unit: their locked-in rate if they
   *  already booked this line, today's rate otherwise. The only number to
   *  multiply by a quantity. */
  rate_cents: number;
  early_amount_cents: number | null;
  early_deadline: string | null;
  /** Whether a booking made today would still get the early rate. */
  early_rate_open: boolean;
  notes: string | null;
};

export type SignupData = {
  show: {
    id: string;
    name: string;
    status: string;
    start_date: string;
    end_date: string;
    office_charge_cents: number;
    office_charge_basis: string;
    shavings_ban_outside: boolean;
  };
  exhibitor: { id: string; full_name: string };
  fee_options: FeeOption[];
  signup: {
    show_entry_id: string;
    registered_at: string;
    back_number: number | null;
    arrival_date: string | null;
    departure_date: string | null;
    notes: string | null;
    reservations: { show_fee_id: string; quantity: number }[];
  } | null;
  /** Step one of registration. `PUT /signup` refuses while this is incomplete,
   *  so any screen rendering these fields has to check it first rather than
   *  offering a form the save will turn away. */
  profile?: ProfileStatus;
  cancellation?: CancellationWindow;
};

/** Grouping for the picker. Units are what the secretary configured on the fee,
 *  so a show that adds its own per-stall or per-night item lands in the right
 *  section without a change here. */
const UNIT_GROUPS: { key: string; heading: string; blurb: string; units: string[] }[] = [
  {
    key: 'stalls',
    heading: 'Stalls',
    blurb: 'How many stalls you need for the whole show.',
    units: ['per_stall'],
  },
  {
    key: 'bedding',
    heading: 'Shavings',
    blurb: 'Bags delivered to your stalls.',
    units: ['per_bag'],
  },
  {
    // per_night, per_day and per_show under one heading because they are the
    // three ways a venue prices the same camping spot, and the show picks one
    // (migrations 108, 111). Splitting them put "Camping" and "For the whole
    // show" side by side and left a whole-show camping spot filed under
    // neither name the exhibitor was looking for.
    //
    // What that split was guarding against — booking two *nights* of a
    // $60-for-the-weekend hook-up and being charged $120 — is now handled where
    // it actually bites: the noun sits against the number being typed, not
    // just in a heading above it. That matters more with per_day in the mix,
    // where the wrong count is off by one rather than obviously doubled.
    key: 'camping',
    heading: 'Camping & hook-ups',
    blurb: 'Space on the grounds.',
    units: ['per_night', 'per_day', 'per_show'],
  },
];

const UNIT_NOUN: Record<string, string> = {
  per_stall: 'stall',
  per_bag: 'bag',
  per_night: 'night',
  per_day: 'day',
  per_show: 'spot',
};

/** What the number in the box counts, said next to the box. A per_night, a
 *  per_day and a per_show line look identical until you read the rate, and
 *  they are the one set in this form where getting the count wrong changes
 *  what you pay — by a whole extra spot for per_show, and by a day for the
 *  night/day pair, which is the easier of the two to miss. */
function unitBlurb(units: string[]): string {
  const camping = ['per_night', 'per_day', 'per_show'].filter((u) => units.includes(u));
  if (camping.length > 1) {
    return 'Check what each line is priced by — nights, days, or one price per spot for the whole show — and count that.';
  }
  if (camping[0] === 'per_show') {
    return 'Charged once each for the whole show, however long you stay.';
  }
  if (camping[0] === 'per_day') {
    return 'Count days, not campers — a Friday-to-Sunday show is three days.';
  }
  if (camping[0] === 'per_night') {
    return 'Count nights, not campers — a Friday-to-Sunday show is two nights.';
  }
  return '';
}

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatDeadline(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  });
}

/**
 * The early-bird line under a fee.
 *
 * Three states, and they are genuinely different to the exhibitor: the
 * discount is still open, the deadline has passed but they already hold the
 * rate from an earlier booking, or the deadline has passed and the standard
 * rate is what they'll pay. The open case is checked first because while the
 * deadline stands, booked and unbooked pay the same thing.
 */
function EarlyRateNote({ fee, noun }: { fee: FeeOption; noun: string }) {
  if (fee.early_amount_cents == null || fee.early_deadline == null) return null;

  if (fee.early_rate_open) {
    return (
      <div className="text-xs mt-0.5 font-medium" style={{ color: '#15803d' }}>
        {formatMoney(fee.early_amount_cents)} per {noun} if you reserve by{' '}
        {formatDeadline(fee.early_deadline)}.
      </div>
    );
  }
  if (fee.rate_cents === fee.early_amount_cents) {
    return (
      <div className="text-xs mt-0.5" style={{ color: '#15803d' }}>
        ✓ Early rate held from your reservation — the deadline has passed, but
        yours still counts.
      </div>
    );
  }
  return (
    <div className="text-xs mt-0.5" style={{ color: '#a08a6e' }}>
      Early rate ended {formatDeadline(fee.early_deadline)}.
    </div>
  );
}

/**
 * What the picker adds up to, for a caller that wants it in a collapsed
 * section header. Exported so the summary and the form cannot disagree.
 */
export function reservationSummary(data: SignupData): { total_cents: number; parts: string[] } {
  const byId = new Map(data.fee_options.map((f) => [f.id, f]));
  let total = 0;
  const parts: string[] = [];
  for (const r of data.signup?.reservations ?? []) {
    const fee = byId.get(r.show_fee_id);
    if (!fee || r.quantity <= 0) continue;
    total += fee.rate_cents * r.quantity;
    const noun = UNIT_NOUN[fee.unit] ?? 'item';
    parts.push(`${r.quantity} ${noun}${r.quantity === 1 ? '' : 's'}`);
  }
  return { total_cents: total, parts };
}

export default function ReservationFields({
  showId,
  data,
  submitLabel,
  totalHint,
  onSaved,
  children,
}: {
  showId: string;
  data: SignupData;
  submitLabel: string;
  /** The line under the total. The sign-up page says class fees come later;
   *  the registration screen has the class picker on it, so it doesn't. */
  totalHint: string;
  /** Run after a successful save. `/signup` forwards to the class picker;
   *  the registration screen is already there and only refreshes. */
  onSaved: () => void;
  /** Anything to sit under the save button — the sign-up page's link onward. */
  children?: React.ReactNode;
}) {
  const { show, fee_options, signup } = data;

  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    const seed: Record<string, number> = {};
    for (const fee of fee_options) seed[fee.id] = 0;
    for (const r of signup?.reservations ?? []) seed[r.show_fee_id] = r.quantity;
    return seed;
  });
  const [arrival, setArrival] = useState(signup?.arrival_date ?? '');
  const [departure, setDeparture] = useState(signup?.departure_date ?? '');
  const [notes, setNotes] = useState(signup?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(
    () =>
      UNIT_GROUPS.map((group) => ({
        ...group,
        fees: fee_options.filter((f) => group.units.includes(f.unit)),
      })).filter((group) => group.fees.length > 0),
    [fee_options],
  );

  const reservationTotal = fee_options.reduce(
    (sum, fee) => sum + fee.rate_cents * (quantities[fee.id] ?? 0),
    0,
  );

  const setQuantity = (feeId: string, value: number) => {
    setQuantities((prev) => ({ ...prev, [feeId]: Math.max(0, Math.min(999, value)) }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (arrival && departure && departure < arrival) {
      setError('Departure date cannot be before the arrival date.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/shows/${showId}/register/signup`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reservations: fee_options
            .filter((f) => (quantities[f.id] ?? 0) > 0)
            .map((f) => ({ show_fee_id: f.id, quantity: quantities[f.id] })),
          arrival_date: arrival || null,
          departure_date: departure || null,
          notes: notes.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const detail =
          typeof json?.detail === 'string'
            ? json.detail
            : json?.detail?.message || json?.error || 'Could not save your sign-up.';
        setError(detail);
        setSaving(false);
        return;
      }
      setSaving(false);
      onSaved();
    } catch {
      setError('Network error — please try again.');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Stated both ways, always. Only rendering the ban left the permissive
          case saying nothing at all, and "nothing" is not an answer to "do I
          need to load six bags into the trailer or not?" — the exhibitor is
          packing either way, and silence just moves the question to a phone
          call to the show office. */}
      {show.shavings_ban_outside ? (
        <div
          className="rounded-lg border p-3 text-sm"
          style={{ backgroundColor: '#fef3c7', borderColor: '#fde68a', color: '#92400e' }}
        >
          <strong>Outside shavings are not allowed at this show.</strong> You&apos;ll need to buy
          your bedding from the show — order the bags you need below.
        </div>
      ) : (
        <div
          className="rounded-lg border p-3 text-sm"
          style={{ backgroundColor: '#f0fdf4', borderColor: '#86efac', color: '#166534' }}
        >
          <strong>You may bring your own shavings to this show.</strong> Ordering bags below is
          optional — they&apos;ll be waiting at your stall if you&apos;d rather not haul your own.
        </div>
      )}

      {groups.length === 0 ? (
        <div
          className="mt-4 rounded-lg border p-4 text-sm"
          style={{ backgroundColor: '#faf7f2', borderColor: '#d4b896', color: '#5d4a37' }}
        >
          This show hasn&apos;t published stall, shavings, or camping options. Save anyway to tell
          the office you&apos;re coming, then enter your classes.
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {groups.map((group) => (
            <section
              key={group.key}
              className="rounded-lg border p-4"
              style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
            >
              <h3 className="font-semibold" style={{ color: '#2c1810' }}>{group.heading}</h3>
              <p className="text-xs mt-0.5 mb-3" style={{ color: '#8b7355' }}>
                {group.blurb}
                {/* Derived from the units actually present, so a show selling
                    camping by the night and a show selling it by the weekend
                    each get the sentence that applies to them. */}
                {group.key === 'camping' && (
                  <> {unitBlurb(group.fees.map((f) => f.unit))}</>
                )}
                {/* Repeated next to the number they're about to type. The
                    callout at the top of the form is read once; this is the
                    line they're looking at when they decide on a quantity. */}
                {group.key === 'bedding' && (
                  <span
                    className="font-medium"
                    style={{ color: show.shavings_ban_outside ? '#92400e' : '#166534' }}
                  >
                    {show.shavings_ban_outside
                      ? ' Outside shavings are not allowed — bedding must be bought here.'
                      : ' Outside shavings are allowed, so this is optional.'}
                  </span>
                )}
              </p>
              <ul className="space-y-2">
                {group.fees.map((fee) => {
                  const qty = quantities[fee.id] ?? 0;
                  const noun = UNIT_NOUN[fee.unit] ?? 'item';
                  return (
                    <li
                      key={fee.id}
                      className="flex items-center justify-between gap-3 rounded border px-3 py-2"
                      style={{ borderColor: '#e8d5b7', backgroundColor: '#fdfbf7' }}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium" style={{ color: '#2c1810' }}>
                          {fee.label}
                        </div>
                        <div className="text-xs" style={{ color: '#8b7355' }}>
                          {fee.rate_cents > 0 ? `${formatMoney(fee.rate_cents)} per ${noun}` : 'No charge'}
                          {fee.rate_cents !== fee.amount_cents && (
                            <>
                              {' '}
                              <s>{formatMoney(fee.amount_cents)}</s>
                            </>
                          )}
                          {fee.notes && <> · {fee.notes}</>}
                        </div>
                        <EarlyRateNote fee={fee} noun={noun} />
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setQuantity(fee.id, qty - 1)}
                          disabled={qty === 0}
                          className="w-8 h-8 rounded border text-lg leading-none disabled:opacity-40"
                          style={{ borderColor: '#d4b896', color: '#5c3d1e', backgroundColor: '#ffffff' }}
                          title={qty === 0 ? `No ${noun}s reserved` : `One fewer ${noun}`}
                          aria-label={`One fewer ${fee.label}`}
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min={0}
                          max={999}
                          value={qty}
                          onChange={(e) => setQuantity(fee.id, Number(e.target.value) || 0)}
                          className="w-16 border rounded px-2 py-1.5 text-sm text-center"
                          style={{ borderColor: '#d4b896' }}
                          aria-label={`Number of ${noun}s — ${fee.label}`}
                        />
                        <button
                          type="button"
                          onClick={() => setQuantity(fee.id, qty + 1)}
                          className="w-8 h-8 rounded border text-lg leading-none"
                          style={{ borderColor: '#d4b896', color: '#5c3d1e', backgroundColor: '#ffffff' }}
                          aria-label={`One more ${fee.label}`}
                        >
                          +
                        </button>
                        {/* Against the box, not only in the heading. Nights and
                            whole-show spots now sit in the same section, and
                            this is the word that tells them apart at the moment
                            the number is typed. */}
                        <span
                          className="text-xs w-11 text-left"
                          style={{ color: '#8b7355' }}
                          aria-hidden
                        >
                          {noun}
                          {qty === 1 ? '' : 's'}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <section
        className="mt-4 rounded-lg border p-4"
        style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
      >
        <h3 className="font-semibold" style={{ color: '#2c1810' }}>Arrival &amp; notes</h3>
        <p className="text-xs mt-0.5 mb-3" style={{ color: '#8b7355' }}>
          Optional — helps the office plan stall assignments.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs" style={{ color: '#8b7355' }}>
            Arriving
            <input
              type="date"
              value={arrival}
              onChange={(e) => setArrival(e.target.value)}
              className="mt-1 w-full border rounded px-3 py-2 text-sm"
              style={{ borderColor: '#d4b896' }}
            />
          </label>
          <label className="text-xs" style={{ color: '#8b7355' }}>
            Leaving
            <input
              type="date"
              value={departure}
              onChange={(e) => setDeparture(e.target.value)}
              className="mt-1 w-full border rounded px-3 py-2 text-sm"
              style={{ borderColor: '#d4b896' }}
            />
          </label>
        </div>
        <label className="text-xs block mt-3" style={{ color: '#8b7355' }}>
          Notes for the show office
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="e.g. stalling with Smith barn, arriving late Friday"
            className="mt-1 w-full border rounded px-3 py-2 text-sm"
            style={{ borderColor: '#d4b896' }}
          />
        </label>
      </section>

      <div
        className="mt-5 rounded-lg border p-4 space-y-3"
        style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider" style={{ color: '#8b7355' }}>
              Stalls, shavings &amp; camping
            </div>
            <div className="text-xl font-bold" style={{ color: '#2c1810' }}>
              {formatMoney(reservationTotal)}
            </div>
            <div className="text-xs" style={{ color: '#8b7355' }}>{totalHint}</div>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded font-medium text-white"
            style={{
              backgroundColor: saving ? '#a89175' : '#8b4513',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : submitLabel}
          </button>
        </div>
        {children}
      </div>

      {error && (
        <div
          className="mt-4 rounded-lg border p-3 text-sm"
          style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }}
        >
          {error}
        </div>
      )}
    </form>
  );
}
