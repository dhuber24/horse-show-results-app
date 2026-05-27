'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

// ── Types ─────────────────────────────────────────────────────────────────────

type Unit =
  | 'flat'
  | 'per_entry'
  | 'per_horse'
  | 'per_judge'
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

interface Judge {
  id: string;
  first_name: string;
  last_name: string;
  affiliations: Array<{ id: string; code: string; name: string }>;
}

interface ShowJudgeType {
  code: string;
  name: string;
}

interface JudgeType {
  code: string;
  name: string;
  count: number;
}

interface JudgeFeeRow {
  fee: ShowFee;
  judgeType: JudgeType | null;
  count: number;
  synthetic: boolean;
}

interface Props {
  showId: string;
  initialOfficeChargeCents: number;
  initialPerHorseFees: ShowFee[];
  initialPerJudgeFees: ShowFee[];
  initialClasses: ClassItem[];
  judges: Judge[];
  judgeTypes: ShowJudgeType[];
}

function dollarsFromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

function centsFromDollars(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(parseFloat(trimmed) * 100);
}

function judgeFeeCode(typeCode: string): string {
  const suffix = typeCode.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `judge_${suffix || 'general'}`;
}

function syntheticJudgeFee(type: JudgeType, sortOrder: number): ShowFee {
  return {
    id: `judge-type:${type.code}`,
    show_id: '',
    code: judgeFeeCode(type.code),
    label: `Judge fee - ${type.name}`,
    amount_cents: 0,
    unit: 'per_judge',
    notes: null,
    sort_order: sortOrder,
  };
}

function feeLooksLikeJudgeType(fee: ShowFee, type: JudgeType): boolean {
  if (fee.code === judgeFeeCode(type.code)) return true;
  const label = fee.label.toLowerCase();
  return label.includes(type.code.toLowerCase()) || label.includes(type.name.toLowerCase());
}

// ── Office Charges (primary + per_horse show_fees) ────────────────────────────

function OfficeChargesTable({
  showId,
  initialCents,
  initialPerHorseFees,
}: {
  showId: string;
  initialCents: number;
  initialPerHorseFees: ShowFee[];
}) {
  const router = useRouter();

  const [primaryDraft, setPrimaryDraft] = useState(dollarsFromCents(initialCents));
  const [primarySaved, setPrimarySaved] = useState(initialCents);
  const [savingPrimary, setSavingPrimary] = useState(false);

  const [fees, setFees] = useState(initialPerHorseFees);
  const [drafts, setDrafts] = useState<Record<string, { label: string; amount: string }>>(
    Object.fromEntries(
      initialPerHorseFees.map((f) => [f.id, { label: f.label, amount: dollarsFromCents(f.amount_cents) }]),
    ),
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRow, setNewRow] = useState({ label: '', amount: '' });
  const [error, setError] = useState<string | null>(null);

  const primaryParsed = centsFromDollars(primaryDraft);
  const primaryInvalid = primaryParsed === null;
  const primaryDirty = !primaryInvalid && primaryParsed !== primarySaved;

  const savePrimary = async () => {
    if (primaryParsed === null) return;
    setSavingPrimary(true);
    setError(null);
    const res = await fetch(`/api/shows/${showId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ office_charge_cents: primaryParsed }),
    });
    setSavingPrimary(false);
    if (res.ok) {
      setPrimarySaved(primaryParsed);
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to save office charge.');
    }
  };

  const saveFee = async (fee: ShowFee) => {
    const draft = drafts[fee.id];
    const cents = centsFromDollars(draft.amount);
    if (cents === null) { setError(`Invalid amount for ${draft.label}.`); return; }
    setBusyId(fee.id);
    setError(null);
    const res = await fetch(`/api/shows/${showId}/fees/${fee.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: draft.label, amount_cents: cents }),
    });
    setBusyId(null);
    if (res.ok) {
      const updated: ShowFee = await res.json();
      setFees((prev) => prev.map((f) => (f.id === fee.id ? updated : f)));
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? `Failed to save ${draft.label}.`);
    }
  };

  const removeFee = async (fee: ShowFee) => {
    setBusyId(fee.id);
    const res = await fetch(`/api/shows/${showId}/fees/${fee.id}`, { method: 'DELETE' });
    setBusyId(null);
    setConfirmDeleteId(null);
    if (res.ok || res.status === 204) {
      setFees((prev) => prev.filter((f) => f.id !== fee.id));
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to remove charge.');
    }
  };

  const addFee = async () => {
    if (!newRow.label.trim()) { setError('Label is required.'); return; }
    const cents = centsFromDollars(newRow.amount);
    if (cents === null) { setError('Invalid amount.'); return; }
    setAdding(true);
    setError(null);
    const code = newRow.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 64);
    const res = await fetch(`/api/shows/${showId}/fees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, label: newRow.label.trim(), amount_cents: cents, unit: 'per_horse', sort_order: fees.length }),
    });
    setAdding(false);
    if (res.ok) {
      const created: ShowFee = await res.json();
      setFees((prev) => [...prev, created]);
      setDrafts((prev) => ({ ...prev, [created.id]: { label: created.label, amount: dollarsFromCents(created.amount_cents) } }));
      setNewRow({ label: '', amount: '' });
      setShowAddForm(false);
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to add charge.');
    }
  };

  return (
    <section className="rounded-lg border p-4 space-y-3" style={{ borderColor: '#d4b896' }}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold" style={{ color: '#2c1810' }}>Office charges</h2>
        {!showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="text-xs px-3 py-1.5 rounded border hover:bg-amber-50"
            style={{ borderColor: '#d4b896', color: '#8b4513' }}
          >
            + Add charge
          </button>
        )}
      </div>
      <p className="text-xs" style={{ color: '#8b7355' }}>
        Per-horse charges collected at the show — office administration, drug testing, etc.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <ul className="divide-y" style={{ borderColor: '#e8d5b7' }}>
        <li className="flex items-center gap-2 py-2">
          <span className="flex-1 text-sm" style={{ color: '#2c1810' }}>Office charge</span>
          <div className="relative w-24">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: '#8b7355' }}>$</span>
            <input
              inputMode="decimal"
              value={primaryDraft}
              onChange={(e) => setPrimaryDraft(e.target.value)}
              className="w-full border rounded pl-5 pr-2 py-1 text-sm"
              style={{ borderColor: primaryInvalid ? '#fca5a5' : '#d4b896' }}
            />
          </div>
          <span className="text-xs w-16" style={{ color: '#8b7355' }}>per horse</span>
          <button
            onClick={savePrimary}
            disabled={savingPrimary || primaryInvalid || !primaryDirty}
            className="text-xs px-2 py-1 rounded font-medium disabled:opacity-40"
            style={{ color: '#8b4513' }}
            title={!primaryDirty ? 'No change' : primaryInvalid ? 'Invalid amount' : 'Save'}
          >
            {savingPrimary ? 'Saving…' : 'Save'}
          </button>
          <span className="w-12" />
        </li>
        {fees.map((fee) => {
          const draft = drafts[fee.id] ?? { label: fee.label, amount: dollarsFromCents(fee.amount_cents) };
          const cents = centsFromDollars(draft.amount);
          const invalid = cents === null;
          const dirty = !invalid && (cents !== fee.amount_cents || draft.label !== fee.label);
          return (
            <li key={fee.id} className="flex items-center gap-2 py-2">
              <input
                value={draft.label}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [fee.id]: { ...draft, label: e.target.value } }))}
                className="flex-1 border rounded px-2 py-1 text-sm"
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
              <span className="text-xs w-16" style={{ color: '#8b7355' }}>per horse</span>
              <button
                onClick={() => saveFee(fee)}
                disabled={busyId === fee.id || invalid || !dirty}
                className="text-xs px-2 py-1 rounded font-medium disabled:opacity-40"
                style={{ color: '#8b4513' }}
              >
                {busyId === fee.id ? '…' : 'Save'}
              </button>
              {confirmDeleteId === fee.id ? (
                <span className="flex items-center gap-1 text-xs w-12">
                  <button onClick={() => removeFee(fee)} className="text-red-600 hover:underline" disabled={busyId === fee.id}>Yes</button>
                  <button onClick={() => setConfirmDeleteId(null)} className="hover:underline" style={{ color: '#8b7355' }}>No</button>
                </span>
              ) : (
                <button onClick={() => setConfirmDeleteId(fee.id)} className="text-xs text-red-600 hover:underline w-12">
                  Remove
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {showAddForm && (
        <div className="rounded border p-3 space-y-2" style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0' }}>
          <p className="text-xs font-semibold" style={{ color: '#2c1810' }}>New per-horse charge</p>
          <div className="flex flex-wrap gap-2 items-end">
            <input
              placeholder="Label (e.g. Drug test fee)"
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
            <button
              onClick={addFee}
              disabled={adding}
              className="px-3 py-1.5 text-sm rounded font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: '#8b4513' }}
            >
              {adding ? 'Adding…' : 'Add'}
            </button>
            <button
              onClick={() => { setShowAddForm(false); setNewRow({ label: '', amount: '' }); setError(null); }}
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

// ── Per-judge fees ────────────────────────────────────────────────────────────

function PerJudgeFeesTable({
  showId,
  initialPerJudgeFees,
  judges,
  configuredJudgeTypes,
}: {
  showId: string;
  initialPerJudgeFees: ShowFee[];
  judges: Judge[];
  configuredJudgeTypes: ShowJudgeType[];
}) {
  const router = useRouter();

  const [fees, setFees] = useState(initialPerJudgeFees);
  const [drafts, setDrafts] = useState<Record<string, { label: string; amount: string }>>(
    Object.fromEntries(
      initialPerJudgeFees.map((f) => [f.id, { label: f.label, amount: dollarsFromCents(f.amount_cents) }]),
    ),
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRow, setNewRow] = useState({ label: '', amount: '' });
  const [error, setError] = useState<string | null>(null);

  const totalJudges = judges.length;
  const judgeTypes = useMemo(() => {
    const byCode = new Map<string, JudgeType>();
    for (const type of configuredJudgeTypes) {
      const code = type.code.trim();
      if (code && code !== 'OPEN' && !byCode.has(code)) {
        byCode.set(code, { code, name: type.name.trim() || code, count: 0 });
      }
    }

    for (const j of judges) {
      const affiliations = j.affiliations.length > 0
        ? j.affiliations
        : [{ id: 'general', code: 'GENERAL', name: 'General' }];

      for (const aff of affiliations) {
        const code = aff.code.trim() || 'GENERAL';
        const existing = byCode.get(code);
        if (existing) {
          existing.count += 1;
        } else {
          byCode.set(code, { code, name: aff.name.trim() || code, count: 1 });
        }
      }
    }
    return Array.from(byCode.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [configuredJudgeTypes, judges]);

  const rows = useMemo<JudgeFeeRow[]>(() => {
    const usedFeeIds = new Set<string>();
    const typeRows = judgeTypes.map((type, index) => {
      const existing = fees.find((fee) => !usedFeeIds.has(fee.id) && feeLooksLikeJudgeType(fee, type));
      if (existing) {
        usedFeeIds.add(existing.id);
        return { fee: existing, judgeType: type, count: type.count, synthetic: false };
      }
      return { fee: syntheticJudgeFee(type, fees.length + index), judgeType: type, count: type.count, synthetic: true };
    });

    const extraRows = fees
      .filter((fee) => !usedFeeIds.has(fee.id))
      .map((fee) => ({ fee, judgeType: null, count: totalJudges, synthetic: false }));

    return [...typeRows, ...extraRows];
  }, [fees, judgeTypes, totalJudges]);

  const saveFee = async (row: JudgeFeeRow) => {
    const fee = row.fee;
    const draft = drafts[fee.id];
    const label = draft?.label ?? fee.label;
    const cents = centsFromDollars(draft?.amount ?? dollarsFromCents(fee.amount_cents));
    if (cents === null) { setError(`Invalid amount for ${label}.`); return; }
    setBusyId(fee.id);
    setError(null);
    const res = await fetch(row.synthetic ? `/api/shows/${showId}/fees` : `/api/shows/${showId}/fees/${fee.id}`, {
      method: row.synthetic ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(row.synthetic
        ? { code: fee.code, label, amount_cents: cents, unit: 'per_judge', sort_order: fee.sort_order }
        : { label, amount_cents: cents }),
    });
    setBusyId(null);
    if (res.ok) {
      const updated: ShowFee = await res.json();
      setFees((prev) => row.synthetic
        ? [...prev, updated]
        : prev.map((f) => (f.id === fee.id ? updated : f)));
      setDrafts((prev) => ({
        ...prev,
        [updated.id]: { label: updated.label, amount: dollarsFromCents(updated.amount_cents) },
      }));
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? `Failed to save ${label}.`);
    }
  };

  const removeFee = async (fee: ShowFee) => {
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

  const addFee = async () => {
    if (!newRow.label.trim()) { setError('Label is required.'); return; }
    const cents = centsFromDollars(newRow.amount);
    if (cents === null) { setError('Invalid amount.'); return; }
    setAdding(true);
    setError(null);
    const code = newRow.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 64);
    const res = await fetch(`/api/shows/${showId}/fees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, label: newRow.label.trim(), amount_cents: cents, unit: 'per_judge', sort_order: fees.length }),
    });
    setAdding(false);
    if (res.ok) {
      const created: ShowFee = await res.json();
      setFees((prev) => [...prev, created]);
      setDrafts((prev) => ({ ...prev, [created.id]: { label: created.label, amount: dollarsFromCents(created.amount_cents) } }));
      setNewRow({ label: '', amount: '' });
      setShowAddForm(false);
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to add fee.');
    }
  };

  const affiliationSummary = judgeTypes
    .map((type) => `${type.count} ${type.code}`)
    .join(' · ');

  return (
    <section className="rounded-lg border p-4 space-y-3" style={{ borderColor: '#d4b896' }}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold" style={{ color: '#2c1810' }}>Per-judge fees</h2>
          <p className="text-xs mt-0.5" style={{ color: '#8b7355' }}>
            {totalJudges === 0
              ? 'No judges entered yet — add judges in the Judges section.'
              : `${totalJudges} judge${totalJudges === 1 ? '' : 's'} on record${affiliationSummary ? ` (${affiliationSummary})` : ''}`}
          </p>
        </div>
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
      {error && <p className="text-xs text-red-600">{error}</p>}
      {rows.length === 0 ? (
        <p className="text-sm italic" style={{ color: '#8b7355' }}>
          No judge fee rows yet. Add judges with affiliations, then enter the fee for each judge type.
        </p>
      ) : (
        <ul className="divide-y" style={{ borderColor: '#e8d5b7' }}>
          {rows.map((row) => {
            const fee = row.fee;
            const draft = drafts[fee.id] ?? { label: fee.label, amount: dollarsFromCents(fee.amount_cents) };
            const cents = centsFromDollars(draft.amount);
            const invalid = cents === null;
            const dirty = row.synthetic || (!invalid && (cents !== fee.amount_cents || draft.label !== fee.label));
            const subtotal = (cents ?? 0) * row.count;
            return (
              <li key={fee.id} className="flex items-center gap-2 py-2 flex-wrap">
                {row.judgeType ? (
                  <div className="flex-1 min-w-[160px]">
                    <p className="text-sm" style={{ color: '#2c1810' }}>{draft.label}</p>
                    <p className="text-xs" style={{ color: '#8b7355' }}>{row.judgeType.code} judge type</p>
                  </div>
                ) : (
                  <input
                    value={draft.label}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [fee.id]: { ...draft, label: e.target.value } }))}
                    className="flex-1 min-w-[120px] border rounded px-2 py-1 text-sm"
                    style={{ borderColor: '#d4b896' }}
                  />
                )}
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
                {row.count > 0 && !invalid && (
                  <span className="text-xs" style={{ color: '#8b7355' }}>
                    x {row.count} = ${(subtotal / 100).toFixed(2)}/horse
                  </span>
                )}
                <button
                  onClick={() => saveFee(row)}
                  disabled={busyId === fee.id || invalid || !dirty}
                  className="text-xs px-2 py-1 rounded font-medium disabled:opacity-40"
                  style={{ color: '#8b4513' }}
                >
                  {busyId === fee.id ? '...' : 'Save'}
                </button>
                {!row.judgeType && (
                  confirmDeleteId === fee.id ? (
                    <span className="flex items-center gap-1 text-xs">
                      <button onClick={() => removeFee(fee)} className="text-red-600 hover:underline" disabled={busyId === fee.id}>Yes</button>
                      <button onClick={() => setConfirmDeleteId(null)} className="hover:underline" style={{ color: '#8b7355' }}>No</button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmDeleteId(fee.id)} className="text-xs text-red-600 hover:underline">
                      Remove
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
      {showAddForm && (
        <div className="rounded border p-3 space-y-2" style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0' }}>
          <p className="text-xs font-semibold" style={{ color: '#2c1810' }}>New per-judge fee</p>
          <div className="flex flex-wrap gap-2 items-end">
            <input
              placeholder="Label (e.g. Judge fee – AQHA)"
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
            <button
              onClick={addFee}
              disabled={adding}
              className="px-3 py-1.5 text-sm rounded font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: '#8b4513' }}
            >
              {adding ? 'Adding…' : 'Add'}
            </button>
            <button
              onClick={() => { setShowAddForm(false); setNewRow({ label: '', amount: '' }); setError(null); }}
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

// ── Per-class entry fees ──────────────────────────────────────────────────────

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
    if (cents === null) { setError(`Invalid amount for class ${cls.class_number}.`); return; }
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
        Charged once per entry (per class per horse).
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

// ── Top-level ─────────────────────────────────────────────────────────────────

export default function EntryFeesEditor({
  showId,
  initialOfficeChargeCents,
  initialPerHorseFees,
  initialPerJudgeFees,
  initialClasses,
  judges,
  judgeTypes,
}: Props) {
  return (
    <div className="space-y-4">
      <OfficeChargesTable
        showId={showId}
        initialCents={initialOfficeChargeCents}
        initialPerHorseFees={initialPerHorseFees}
      />
      <PerJudgeFeesTable
        showId={showId}
        initialPerJudgeFees={initialPerJudgeFees}
        judges={judges}
        configuredJudgeTypes={judgeTypes}
      />
      <ClassFeesTable showId={showId} initialClasses={initialClasses} />
    </div>
  );
}
