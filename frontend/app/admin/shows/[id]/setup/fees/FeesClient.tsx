'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type SanctioningFeeState = { association_id: string; dollars: string };

export type FeeRow = {
  id: string;
  code: string;
  label: string;
  amount_cents: number;
  unit: string;
  notes: string | null;
};

export type SanctioningRow = {
  association_id: string;
  code: string;
  name: string;
  per_class_fee_cents: number;
};

const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  border: '#d4b896',
  bg: '#fff',
  warn: '#5c3d1e',
  warnSoft: '#fdf8eb',
} as const;

const SLOTS = [
  {
    code: 'standard_class',
    label: 'Standard class fee (per entry)',
    unit: 'per_entry',
    placeholder: 'e.g. 25.00',
    notesPlaceholder: 'e.g. Includes association sanction fee',
  },
  {
    code: 'jackpot',
    label: 'Jackpot / sidepot fee (per entry)',
    unit: 'per_entry',
    placeholder: 'e.g. 15.00',
    notesPlaceholder: 'e.g. 80% paid back to top 3',
  },
  {
    code: 'futurity',
    label: 'Futurity class fee (per entry)',
    unit: 'per_entry',
    placeholder: 'e.g. 100.00',
    notesPlaceholder: 'e.g. 75% payback',
  },
] as const;

type SlotState = { feeId: string | null; dollars: string; notes: string };

function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function dollarsToCents(input: string): number {
  const n = Number.parseFloat(input);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

export default function FeesClient({
  showId,
  initialOfficeChargeCents,
  initialOfficeChargeBasis,
  initialFees,
  sanctioning,
}: {
  showId: string;
  initialOfficeChargeCents: number;
  initialOfficeChargeBasis: string;
  initialFees: FeeRow[];
  sanctioning: SanctioningRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [officeChargeDollars, setOfficeChargeDollars] = useState(
    initialOfficeChargeCents > 0 ? centsToDollars(initialOfficeChargeCents) : '',
  );
  const [officeChargeBasis, setOfficeChargeBasis] = useState<
    'per_back_number' | 'per_horse'
  >(
    initialOfficeChargeBasis === 'per_horse' ? 'per_horse' : 'per_back_number',
  );

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

  const [sanctioningFees, setSanctioningFees] = useState<SanctioningFeeState[]>(
    sanctioning.map((s) => ({
      association_id: s.association_id,
      dollars: centsToDollars(s.per_class_fee_cents),
    })),
  );

  function setSanctioningFee(id: string, dollars: string) {
    setSanctioningFees((prev) =>
      prev.map((s) =>
        s.association_id === id ? { ...s, dollars } : s,
      ),
    );
  }

  function setSlot(code: string, patch: Partial<SlotState>) {
    setSlots((prev) => ({ ...prev, [code]: { ...prev[code], ...patch } }));
  }

  async function save() {
    setError(null);
    setSuccessMsg(null);
    setBusy(true);
    try {
      // Office charge + basis live on the show row.
      const showRes = await fetch(`/api/shows/${showId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          office_charge_cents: dollarsToCents(officeChargeDollars || '0'),
          office_charge_basis: officeChargeBasis,
        }),
      });
      if (!showRes.ok) {
        const j = await showRes.json().catch(() => null);
        setError(j?.detail || 'Failed to update office charge.');
        return;
      }

      // Class-level fee slots in show_fees.
      for (const s of SLOTS) {
        const slot = slots[s.code];
        const isEmpty = slot.dollars.trim() === '';
        const cents = dollarsToCents(slot.dollars);

        if (slot.feeId && isEmpty) {
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

      // Sanctioning per-class fees: PUT replaces the full set, so we send
      // every currently-selected sanction with its (possibly updated) fee.
      if (sanctioningFees.length > 0) {
        const sancRes = await fetch(`/api/shows/${showId}/sanctioning`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: sanctioningFees.map((s) => ({
              association_id: s.association_id,
              per_class_fee_cents: dollarsToCents(s.dollars || '0'),
            })),
          }),
        });
        if (!sancRes.ok) {
          const j = await sancRes.json().catch(() => null);
          setError(j?.detail || 'Failed to update sanctioning fees.');
          return;
        }
      }

      // Step 5 is the final wizard step — when the save succeeds the user
      // has reached the end of setup, so take them to the main show admin
      // page rather than refreshing in place.
      router.push(`/admin/shows/${showId}`);
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
        className="p-4 rounded-lg border space-y-3"
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
      >
        <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
          Office charge
        </h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
              Amount ($)
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={officeChargeDollars}
              onChange={(e) => setOfficeChargeDollars(e.target.value)}
              className="w-full border rounded px-3 py-2"
              style={{ borderColor: COLORS.border }}
              placeholder="e.g. 10.00"
            />
          </label>
          <label className="block">
            <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
              Charged...
            </span>
            <select
              value={officeChargeBasis}
              onChange={(e) =>
                setOfficeChargeBasis(
                  e.target.value === 'per_horse' ? 'per_horse' : 'per_back_number',
                )
              }
              className="w-full border rounded px-3 py-2"
              style={{ borderColor: COLORS.border }}
            >
              <option value="per_back_number">per back number (exhibitor)</option>
              <option value="per_horse">per horse</option>
            </select>
          </label>
        </div>
      </section>

      <section
        className="p-4 rounded-lg border space-y-4"
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
      >
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
            Class fees
          </h2>
          <span className="text-xs" style={{ color: COLORS.muted }}>
            Leave any amount blank to skip
          </span>
        </div>
        {SLOTS.map((s) => {
          const slot = slots[s.code];
          return (
            <div key={s.code} className="grid sm:grid-cols-[1fr_8rem_1fr] gap-3 items-end">
              <span>
                <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
                  {s.label}
                </span>
              </span>
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
                  placeholder={s.notesPlaceholder}
                />
              </label>
            </div>
          );
        })}

        {sanctioning.length === 0 ? (
          <p className="text-xs" style={{ color: COLORS.muted }}>
            Sanctioning fees:{' '}
            <Link
              href={`/admin/shows/${showId}/setup/sanctioning`}
              className="underline"
              style={{ color: COLORS.warn }}
            >
              add sanctioning associations in Step 3
            </Link>{' '}
            to set per-class fees here.
          </p>
        ) : (
          <>
            <div
              className="border-t pt-3 mt-1"
              style={{ borderColor: COLORS.border }}
            >
              <p className="text-xs mb-2" style={{ color: COLORS.muted }}>
                Sanctioning per-class fees (added on top of the standard class
                fee for eligible classes)
              </p>
              {sanctioning.map((s) => {
                const fee = sanctioningFees.find(
                  (f) => f.association_id === s.association_id,
                );
                return (
                  <div
                    key={s.association_id}
                    className="grid sm:grid-cols-[1fr_8rem_1fr] gap-3 items-end mb-2"
                  >
                    <span>
                      <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
                        {s.name}
                      </span>
                      <span className="font-mono text-xs" style={{ color: '#8b4513' }}>
                        {s.code} per-entry fee
                      </span>
                    </span>
                    <label className="block">
                      <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
                        Amount ($)
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={fee?.dollars ?? ''}
                        onChange={(e) =>
                          setSanctioningFee(s.association_id, e.target.value)
                        }
                        className="w-full border rounded px-3 py-2"
                        style={{ borderColor: COLORS.border }}
                        placeholder="e.g. 3.00"
                      />
                    </label>
                    <span />
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="text-sm rounded px-4 py-2 disabled:opacity-50"
          style={{ backgroundColor: COLORS.warn, color: '#fff' }}
        >
          {busy ? 'Saving…' : 'Save & finish setup →'}
        </button>
      </div>
    </div>
  );
}
