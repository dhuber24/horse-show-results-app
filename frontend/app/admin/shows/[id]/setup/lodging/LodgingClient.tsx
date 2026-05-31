'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type FeeRow = {
  id: string;
  code: string;
  label: string;
  amount_cents: number;
  unit: string;
  notes: string | null;
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
  dollars: string;
  notes: string;
};

const SLOTS = [
  { code: 'stall', label: 'Stall (per stall)', unit: 'per_stall', placeholder: 'e.g. 75.00' },
  { code: 'shavings', label: 'Shavings (per bag)', unit: 'per_bag', placeholder: 'e.g. 10.00' },
  {
    code: 'camping',
    label: 'Camping (per night)',
    unit: 'per_night',
    placeholder: 'e.g. 30.00 — note if electric is included',
  },
] as const;

function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function dollarsToCents(input: string): number {
  const n = Number.parseFloat(input);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
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

  function findFee(code: string): FeeRow | undefined {
    return initialFees.find((f) => f.code === code);
  }

  const [slots, setSlots] = useState<Record<string, SlotState>>(() => {
    const base: Record<string, SlotState> = {};
    for (const s of SLOTS) {
      const fee = findFee(s.code);
      base[s.code] = {
        feeId: fee?.id ?? null,
        dollars: fee ? centsToDollars(fee.amount_cents) : '',
        notes: fee?.notes ?? '',
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

        if (slot.feeId && isEmpty) {
          // remove
          const res = await fetch(`/api/shows/${showId}/fees/${slot.feeId}`, {
            method: 'DELETE',
          });
          if (!res.ok && res.status !== 204) {
            const j = await res.json().catch(() => null);
            setError(j?.detail || `Failed to remove ${s.label}.`);
            return;
          }
        } else if (slot.feeId && !isEmpty) {
          const res = await fetch(`/api/shows/${showId}/fees/${slot.feeId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              amount_cents: cents,
              notes: slot.notes.trim() || null,
            }),
          });
          if (!res.ok) {
            const j = await res.json().catch(() => null);
            setError(j?.detail || `Failed to update ${s.label}.`);
            return;
          }
        } else if (!slot.feeId && !isEmpty) {
          const res = await fetch(`/api/shows/${showId}/fees`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code: s.code,
              label: s.label,
              unit: s.unit,
              amount_cents: cents,
              notes: slot.notes.trim() || null,
            }),
          });
          if (!res.ok) {
            const j = await res.json().catch(() => null);
            setError(j?.detail || `Failed to create ${s.label}.`);
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
          return (
            <div key={s.code} className="space-y-2">
              <div className="grid sm:grid-cols-[1fr_8rem_1fr] gap-3 items-end">
                <div>
                  <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
                    {s.label}
                  </span>
                  <span className="text-sm" style={{ color: COLORS.text }}>
                    Cost per {s.unit.replace('per_', '')}
                  </span>
                </div>
                <label className="block">
                  <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
                    Amount ($)
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={slot.dollars}
                    onChange={(e) => setSlot(s.code, { dollars: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                    style={{ borderColor: COLORS.border }}
                    placeholder={s.placeholder}
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
                    placeholder={
                      s.code === 'camping' ? 'e.g. Includes electric hookup' : ''
                    }
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
          to other show fees.
        </p>
      </section>
    </div>
  );
}
