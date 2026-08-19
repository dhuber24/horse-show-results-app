'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export type FeeOption = {
  id: string;
  code: string;
  label: string;
  unit: string;
  /** The standard (post-deadline) rate. */
  amount_cents: number;
  /** What *this* exhibitor is charged per unit: their locked-in rate if they
   *  already booked this line, today's rate otherwise. The only number to
   *  multiply by a quantity — quoting `amount_cents` while the backend bills
   *  the early rate is exactly the disagreement billing.py exists to prevent. */
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
    key: 'camping',
    heading: 'Camping',
    blurb: 'Nights on the grounds. Count nights, not campers.',
    units: ['per_night'],
  },
];

const UNIT_NOUN: Record<string, string> = {
  per_stall: 'stall',
  per_bag: 'bag',
  per_night: 'night',
};

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

export default function SignupForm({ showId, data }: { showId: string; data: SignupData }) {
  const router = useRouter();
  const { show, exhibitor, fee_options, signup } = data;

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
      router.push(`/shows/${showId}/register`);
      router.refresh();
    } catch {
      setError('Network error — please try again.');
      setSaving(false);
    }
  };

  const alreadySignedUp = signup !== null;

  return (
    <form onSubmit={handleSubmit} className="mt-6">
      <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>{show.name}</h1>
      <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
        {alreadySignedUp ? 'Update your show sign-up' : 'Sign up for this show'} — {exhibitor.full_name}
      </p>

      <div
        className="mt-4 rounded-lg border p-3 text-sm"
        style={{ backgroundColor: '#faf7f2', borderColor: '#d4b896', color: '#5d4a37' }}
      >
        {alreadySignedUp ? (
          <>
            You&apos;re signed up for this show. Change your stall, shavings, or camping numbers here
            any time while registration is open.
          </>
        ) : (
          <>
            Sign-up tells the show office you&apos;re coming and reserves your stalls, shavings, and
            camping. Once you&apos;re signed up you can enter classes. Fees shown are informational —
            payment is collected at the show.
          </>
        )}
      </div>

      {/* Stated both ways, always. Only rendering the ban left the permissive
          case saying nothing at all, and "nothing" is not an answer to "do I
          need to load six bags into the trailer or not?" — the exhibitor is
          packing either way, and silence just moves the question to a phone
          call to the show office. */}
      {show.shavings_ban_outside ? (
        <div
          className="mt-3 rounded-lg border p-3 text-sm"
          style={{ backgroundColor: '#fef3c7', borderColor: '#fde68a', color: '#92400e' }}
        >
          <strong>Outside shavings are not allowed at this show.</strong> You&apos;ll need to buy
          your bedding from the show — order the bags you need below.
        </div>
      ) : (
        <div
          className="mt-3 rounded-lg border p-3 text-sm"
          style={{ backgroundColor: '#f0fdf4', borderColor: '#86efac', color: '#166534' }}
        >
          <strong>You may bring your own shavings to this show.</strong> Ordering bags below is
          optional — they&apos;ll be waiting at your stall if you&apos;d rather not haul your own.
        </div>
      )}

      {groups.length === 0 ? (
        <div
          className="mt-6 rounded-lg border p-4 text-sm"
          style={{ backgroundColor: '#faf7f2', borderColor: '#d4b896', color: '#5d4a37' }}
        >
          This show hasn&apos;t published stall, shavings, or camping options. Sign up anyway to tell
          the office you&apos;re coming, then enter your classes.
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          {groups.map((group) => (
            <section
              key={group.key}
              className="rounded-lg border p-4"
              style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
            >
              <h2 className="font-semibold" style={{ color: '#2c1810' }}>{group.heading}</h2>
              <p className="text-xs mt-0.5 mb-3" style={{ color: '#8b7355' }}>
                {group.blurb}
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
                          aria-label={`Number of ${fee.label}`}
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
        className="mt-5 rounded-lg border p-4"
        style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
      >
        <h2 className="font-semibold" style={{ color: '#2c1810' }}>Arrival &amp; notes</h2>
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
        className="mt-8 rounded-lg border p-4 sticky bottom-4 space-y-3"
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
            <div className="text-xs" style={{ color: '#8b7355' }}>
              Class fees are added when you enter classes.
            </div>
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
            {saving ? 'Saving…' : alreadySignedUp ? 'Save changes' : 'Sign up & pick classes'}
          </button>
        </div>
        {alreadySignedUp && (
          <div className="pt-2 border-t" style={{ borderColor: '#e8d5b7' }}>
            <Link
              href={`/shows/${showId}/register`}
              className="text-sm font-medium hover:underline"
              style={{ color: '#8b4513' }}
            >
              Go to my class registration →
            </Link>
          </div>
        )}
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
