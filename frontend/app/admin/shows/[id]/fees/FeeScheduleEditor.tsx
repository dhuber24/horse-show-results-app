'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Unit =
  | 'flat'
  | 'per_entry'
  | 'per_horse'
  | 'per_class_per_horse'
  | 'per_night'
  | 'per_stall'
  | 'per_bag'
  | 'percent_of_entry';

interface ShowFee {
  id: string;
  show_id: string;
  code: string;
  label: string;
  amount_cents: number;
  unit: Unit;
  notes: string | null;
  sort_order: number;
}

interface ClassItem {
  id: string;
  class_number: string;
  class_name: string;
  entry_fee_cents: number;
  sort_order: number | null;
}

interface Props {
  showId: string;
  initialFees: ShowFee[];
  initialOfficeChargeCents: number;
  initialClasses: ClassItem[];
}

const UNIT_LABELS: Record<Unit, string> = {
  flat: 'flat',
  per_entry: 'per entry',
  per_horse: 'per horse',
  per_class_per_horse: 'per class per horse',
  per_night: 'per night',
  per_stall: 'per stall',
  per_bag: 'per bag',
  percent_of_entry: '% of entry',
};

const UNIT_OPTIONS: Unit[] = [
  'flat',
  'per_entry',
  'per_horse',
  'per_night',
  'per_stall',
  'per_bag',
  'percent_of_entry',
];

function dollarsFromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

function centsFromDollars(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(parseFloat(trimmed) * 100);
}

// ── Office Charge card ────────────────────────────────────────────────────────

function OfficeChargeCard({ showId, initialCents }: { showId: string; initialCents: number }) {
  const router = useRouter();
  const [amount, setAmount] = useState(dollarsFromCents(initialCents));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedCents, setSavedCents] = useState(initialCents);

  const parsed = centsFromDollars(amount);
  const invalid = parsed === null;
  const dirty = !invalid && parsed !== savedCents;

  const save = async () => {
    if (parsed === null) return;
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/shows/${showId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ office_charge_cents: parsed }),
    });
    setSaving(false);
    if (res.ok) {
      setSavedCents(parsed);
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to save office charge.');
    }
  };

  return (
    <section className="rounded-lg border p-4 space-y-2" style={{ borderColor: '#d4b896' }}>
      <h2 className="font-semibold" style={{ color: '#2c1810' }}>Office charge</h2>
      <p className="text-xs" style={{ color: '#8b7355' }}>
        One-time charge per horse for the show. AQHA-sanctioned shows typically
        collect $10/horse + $3 per judge for show administration.
      </p>
      <div className="flex items-end gap-3">
        <div>
          <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Amount (USD)</label>
          <div className="relative w-32">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: '#8b7355' }}>$</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full border rounded pl-6 pr-3 py-2 text-sm"
              style={{ borderColor: invalid ? '#fca5a5' : '#d4b896' }}
            />
          </div>
        </div>
        <span className="text-xs pb-2" style={{ color: '#8b7355' }}>per horse</span>
        <button
          onClick={save}
          disabled={saving || invalid || !dirty}
          className="px-3 py-2 text-sm rounded font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: '#8b4513' }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {error && <span className="text-xs text-red-600 pb-2">{error}</span>}
      </div>
    </section>
  );
}

// ── Per-class entry fees table ────────────────────────────────────────────────

function ClassFeesTable({ showId, initialClasses }: { showId: string; initialClasses: ClassItem[] }) {
  const router = useRouter();
  const [classes, setClasses] = useState(initialClasses);
  const [drafts, setDrafts] = useState<Record<string, string>>(
    Object.fromEntries(initialClasses.map((c) => [c.id, dollarsFromCents(c.entry_fee_cents)])),
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveClass = async (cls: ClassItem) => {
    const cents = centsFromDollars(drafts[cls.id] ?? '');
    if (cents === null) {
      setError(`Invalid amount for class ${cls.class_number}.`);
      return;
    }
    if (cents === cls.entry_fee_cents) return;
    setSavingId(cls.id);
    setError(null);
    const res = await fetch('/api/classes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId, classId: cls.id, entry_fee_cents: cents }),
    });
    setSavingId(null);
    if (res.ok) {
      setClasses((prev) => prev.map((c) => (c.id === cls.id ? { ...c, entry_fee_cents: cents } : c)));
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? `Failed to save fee for class ${cls.class_number}.`);
    }
  };

  if (classes.length === 0) {
    return (
      <section className="rounded-lg border p-4" style={{ borderColor: '#d4b896' }}>
        <h2 className="font-semibold mb-1" style={{ color: '#2c1810' }}>Class entry fees</h2>
        <p className="text-sm" style={{ color: '#8b7355' }}>
          No classes yet. Add classes from the Show home page, then come back to set fees.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border p-4 space-y-3" style={{ borderColor: '#d4b896' }}>
      <h2 className="font-semibold" style={{ color: '#2c1810' }}>Class entry fees</h2>
      <p className="text-xs" style={{ color: '#8b7355' }}>
        Charged once per entry (per class per horse). Save after editing each row.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <ul className="divide-y" style={{ borderColor: '#e8d5b7' }}>
        {classes.map((cls) => {
          const draft = drafts[cls.id] ?? '';
          const parsed = centsFromDollars(draft);
          const invalid = parsed === null;
          const dirty = !invalid && parsed !== cls.entry_fee_cents;
          return (
            <li key={cls.id} className="flex items-center gap-3 py-2">
              <div className="flex-1 min-w-0">
                <span className="text-xs font-mono mr-2 px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: '#f0e8d8', color: '#8b4513' }}>
                  #{cls.class_number}
                </span>
                <span className="text-sm" style={{ color: '#2c1810' }}>{cls.class_name}</span>
              </div>
              <div className="relative w-24">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: '#8b7355' }}>$</span>
                <input
                  inputMode="decimal"
                  value={draft}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [cls.id]: e.target.value }))}
                  className="w-full border rounded pl-5 pr-2 py-1 text-sm"
                  style={{ borderColor: invalid ? '#fca5a5' : '#d4b896' }}
                />
              </div>
              <button
                onClick={() => saveClass(cls)}
                disabled={savingId === cls.id || invalid || !dirty}
                className="text-xs px-2 py-1 rounded font-medium disabled:opacity-40"
                style={{ color: '#8b4513' }}
                title={!dirty ? 'No change' : invalid ? 'Invalid amount' : 'Save'}
              >
                {savingId === cls.id ? 'Saving…' : 'Save'}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── Other fees (show_fees CRUD) ───────────────────────────────────────────────

function OtherFeesTable({ showId, initialFees }: { showId: string; initialFees: ShowFee[] }) {
  const router = useRouter();
  const [fees, setFees] = useState(initialFees);
  const [drafts, setDrafts] = useState<Record<string, { label: string; amount: string; unit: Unit }>>(
    Object.fromEntries(
      initialFees.map((f) => [f.id, { label: f.label, amount: dollarsFromCents(f.amount_cents), unit: f.unit }]),
    ),
  );
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState({ code: '', label: '', amount: '', unit: 'flat' as Unit });
  const [showAddForm, setShowAddForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refreshDrafts = (next: ShowFee[]) => {
    setDrafts(
      Object.fromEntries(
        next.map((f) => [f.id, { label: f.label, amount: dollarsFromCents(f.amount_cents), unit: f.unit }]),
      ),
    );
  };

  const seedDefaults = async () => {
    setError(null);
    const res = await fetch(`/api/shows/${showId}/fees/seed`, { method: 'POST' });
    if (res.ok) {
      const seeded: ShowFee[] = await res.json();
      const merged = [...fees, ...seeded].sort((a, b) => a.sort_order - b.sort_order);
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
    if (cents === null) {
      setError(`Invalid amount for ${fee.label}.`);
      return;
    }
    setBusyId(fee.id);
    setError(null);
    const res = await fetch(`/api/shows/${showId}/fees/${fee.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: draft.label,
        amount_cents: cents,
        unit: draft.unit,
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
    if (!newRow.label.trim()) {
      setError('Label is required.');
      return;
    }
    const cents = centsFromDollars(newRow.amount);
    if (cents === null) {
      setError('Invalid amount.');
      return;
    }
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
      }),
    });
    setAdding(false);
    if (res.ok) {
      const created: ShowFee = await res.json();
      const merged = [...fees, created];
      setFees(merged);
      setDrafts((prev) => ({ ...prev, [created.id]: { label: created.label, amount: dollarsFromCents(created.amount_cents), unit: created.unit } }));
      setNewRow({ code: '', label: '', amount: '', unit: 'flat' });
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
        <h2 className="font-semibold" style={{ color: '#2c1810' }}>Other fees</h2>
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
        Stalls, campsites, late entry, drug test, sanction surcharges, etc. Each
        row has its own unit so totals can be computed correctly later.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}

      {fees.length === 0 ? (
        <p className="text-sm italic" style={{ color: '#8b7355' }}>
          No additional fees configured. Use &quot;Seed common fees&quot; to start with a
          typical set, or &quot;Add fee&quot; to create your own.
        </p>
      ) : (
        <ul className="divide-y" style={{ borderColor: '#e8d5b7' }}>
          {fees.map((fee) => {
            const draft = drafts[fee.id] ?? { label: fee.label, amount: dollarsFromCents(fee.amount_cents), unit: fee.unit };
            const cents = centsFromDollars(draft.amount);
            const invalid = cents === null;
            const dirty =
              !invalid && (cents !== fee.amount_cents || draft.label !== fee.label || draft.unit !== fee.unit);
            return (
              <li key={fee.id} className="flex items-center flex-wrap gap-2 py-2">
                <input
                  value={draft.label}
                  onChange={(e) =>
                    setDrafts((prev) => ({ ...prev, [fee.id]: { ...draft, label: e.target.value } }))
                  }
                  className="flex-1 min-w-[140px] border rounded px-2 py-1 text-sm"
                  style={{ borderColor: '#d4b896' }}
                />
                <div className="relative w-24">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: '#8b7355' }}>$</span>
                  <input
                    inputMode="decimal"
                    value={draft.amount}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [fee.id]: { ...draft, amount: e.target.value } }))
                    }
                    className="w-full border rounded pl-5 pr-2 py-1 text-sm"
                    style={{ borderColor: invalid ? '#fca5a5' : '#d4b896' }}
                  />
                </div>
                <select
                  value={draft.unit}
                  onChange={(e) =>
                    setDrafts((prev) => ({ ...prev, [fee.id]: { ...draft, unit: e.target.value as Unit } }))
                  }
                  className="border rounded px-2 py-1 text-sm"
                  style={{ borderColor: '#d4b896' }}
                >
                  {UNIT_OPTIONS.map((u) => (
                    <option key={u} value={u}>{UNIT_LABELS[u]}</option>
                  ))}
                </select>
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
                    <span style={{ color: '#5c3d1e' }}>Remove?</span>
                    <button
                      onClick={() => removeRow(fee)}
                      className="text-red-600 hover:underline"
                      disabled={busyId === fee.id}
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="hover:underline"
                      style={{ color: '#8b7355' }}
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(fee.id)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {showAddForm && (
        <div className="rounded border p-3 space-y-2" style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0' }}>
          <p className="text-xs font-semibold" style={{ color: '#2c1810' }}>New fee</p>
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
              {UNIT_OPTIONS.map((u) => (
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
              onClick={() => { setShowAddForm(false); setNewRow({ code: '', label: '', amount: '', unit: 'flat' }); }}
              className="text-xs hover:underline"
              style={{ color: '#8b7355' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Top-level ─────────────────────────────────────────────────────────────────

export default function FeeScheduleEditor({
  showId,
  initialFees,
  initialOfficeChargeCents,
  initialClasses,
}: Props) {
  return (
    <div className="space-y-4">
      <OfficeChargeCard showId={showId} initialCents={initialOfficeChargeCents} />
      <ClassFeesTable showId={showId} initialClasses={initialClasses} />
      <OtherFeesTable showId={showId} initialFees={initialFees} />
    </div>
  );
}
