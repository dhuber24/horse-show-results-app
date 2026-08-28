'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AUTOMATIC_FEE_UNITS,
  unitLabel,
  usesJudgeCount,
  type FeeUnit,
} from '@/lib/fee-units';

/**
 * The show's own charges — the ones every exhibitor who entered a class pays,
 * whether they asked for them or not.
 *
 * One editor, used by setup Step 5 and the Entry Fees screen, because both were
 * writing the same `show_fees` rows with different vocabulary and one of them
 * was writing a unit the backend no longer accepts. An aggregate screen quotes
 * rather than computes (see Claude.md); the same rule applies to an editor —
 * there is one place these rows are shaped.
 *
 * The office charge on the show row is deliberately not edited here. It is a
 * column on `shows`, not a fee row, and each screen that wants it renders its
 * own control for it beside this one.
 */

export type ShowCharge = {
  id: string;
  show_id: string;
  code: string;
  label: string;
  amount_cents: number;
  unit: FeeUnit;
  notes: string | null;
  sort_order: number;
};

type Draft = { label: string; amount: string; unit: FeeUnit; notes: string };

const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  border: '#d4b896',
  soft: '#e8d5b7',
  accent: '#8b4513',
  panel: '#faf6f0',
} as const;

function dollarsFromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

function centsFromDollars(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(parseFloat(trimmed) * 100);
}

function codeFromLabel(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64) || 'charge'
  );
}

/**
 * What one charge costs an exhibitor, spelled out.
 *
 * A rate on its own does not tell a manager what they just set up: $5.00 per
 * judge per horse is $30 to somebody with two horses at a three-judge show, and
 * that is the number they are checking against a paper bill.
 */
function chargeExplanation(unit: string, cents: number, judgeCount: number): string {
  const rate = `$${dollarsFromCents(cents)}`;
  const judges = `${judgeCount} judge${judgeCount === 1 ? '' : 's'}`;
  switch (unit) {
    case 'per_exhibitor':
      return `${rate} once per exhibitor, however many horses they bring.`;
    case 'per_horse':
      return `${rate} for each horse they enter.`;
    case 'per_judge_per_exhibitor':
      return judgeCount > 0
        ? `${rate} × ${judges} = $${dollarsFromCents(cents * judgeCount)} per exhibitor.`
        : `${rate} per judge, charged once per exhibitor.`;
    case 'per_judge_per_horse':
      return judgeCount > 0
        ? `${rate} × ${judges} = $${dollarsFromCents(
            cents * judgeCount,
          )} for each horse they enter.`
        : `${rate} per judge, for each horse they enter.`;
    default:
      return '';
  }
}

function BasisSelect({
  value,
  onChange,
}: {
  value: FeeUnit;
  onChange: (unit: FeeUnit) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as FeeUnit)}
      aria-label="Charged"
      className="border rounded px-2 py-1 text-sm"
      style={{ borderColor: COLORS.border, color: COLORS.text }}
    >
      {AUTOMATIC_FEE_UNITS.map((unit) => (
        <option key={unit} value={unit}>
          {unitLabel(unit)}
        </option>
      ))}
    </select>
  );
}

export default function ShowChargesEditor({
  showId,
  initialCharges,
  judgeCount,
  judgesHref,
}: {
  showId: string;
  initialCharges: ShowCharge[];
  /** How many judges are on this show's panel. A per-judge charge multiplies by
   *  it, so a show with none assigned yet bills nothing for one — which the
   *  screen says outright rather than leaving the manager to discover it on
   *  somebody's bill. */
  judgeCount: number;
  /** Where to go and fix an empty panel. */
  judgesHref?: string;
}) {
  const router = useRouter();

  const [charges, setCharges] = useState(initialCharges);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      initialCharges.map((c) => [
        c.id,
        {
          label: c.label,
          amount: dollarsFromCents(c.amount_cents),
          unit: c.unit,
          notes: c.notes ?? '',
        },
      ]),
    ),
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState<Draft>({
    label: '',
    amount: '',
    unit: 'per_horse',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);

  const draftFor = (charge: ShowCharge): Draft =>
    drafts[charge.id] ?? {
      label: charge.label,
      amount: dollarsFromCents(charge.amount_cents),
      unit: charge.unit,
      notes: charge.notes ?? '',
    };

  const patchDraft = (charge: ShowCharge, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [charge.id]: { ...draftFor(charge), ...patch } }));

  async function save(charge: ShowCharge) {
    const draft = draftFor(charge);
    if (!draft.label.trim()) {
      setError('A fee needs a name — it is what the exhibitor reads on their bill.');
      return;
    }
    const cents = centsFromDollars(draft.amount);
    if (cents === null) {
      setError(`Invalid amount for ${draft.label}.`);
      return;
    }
    setBusyId(charge.id);
    setError(null);
    const res = await fetch(`/api/shows/${showId}/fees/${charge.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: draft.label.trim(),
        amount_cents: cents,
        unit: draft.unit,
        notes: draft.notes.trim() || null,
      }),
    });
    setBusyId(null);
    if (res.ok) {
      const updated: ShowCharge = await res.json();
      setCharges((prev) => prev.map((c) => (c.id === charge.id ? updated : c)));
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? `Failed to save ${draft.label}.`);
    }
  }

  async function remove(charge: ShowCharge) {
    setBusyId(charge.id);
    const res = await fetch(`/api/shows/${showId}/fees/${charge.id}`, { method: 'DELETE' });
    setBusyId(null);
    setConfirmDeleteId(null);
    if (res.ok || res.status === 204) {
      setCharges((prev) => prev.filter((c) => c.id !== charge.id));
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to remove that fee.');
    }
  }

  async function add() {
    if (!newRow.label.trim()) {
      setError('A fee needs a name — it is what the exhibitor reads on their bill.');
      return;
    }
    const cents = centsFromDollars(newRow.amount);
    if (cents === null) {
      setError('Invalid amount.');
      return;
    }
    setAdding(true);
    setError(null);
    const res = await fetch(`/api/shows/${showId}/fees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: codeFromLabel(newRow.label),
        label: newRow.label.trim(),
        amount_cents: cents,
        unit: newRow.unit,
        notes: newRow.notes.trim() || null,
        sort_order: charges.length,
      }),
    });
    setAdding(false);
    if (res.ok) {
      const created: ShowCharge = await res.json();
      setCharges((prev) => [...prev, created]);
      setDrafts((prev) => ({
        ...prev,
        [created.id]: {
          label: created.label,
          amount: dollarsFromCents(created.amount_cents),
          unit: created.unit,
          notes: created.notes ?? '',
        },
      }));
      setNewRow({ label: '', amount: '', unit: 'per_horse', notes: '' });
      setShowAddForm(false);
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to add that fee.');
    }
  }

  const judgePanelMissing =
    judgeCount === 0 && charges.some((c) => usesJudgeCount(c.unit) && c.amount_cents > 0);

  return (
    <section
      className="p-4 rounded-lg border space-y-3"
      style={{ borderColor: COLORS.border, backgroundColor: '#fff' }}
    >
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
            Other fees
          </h2>
          <p className="text-xs mt-0.5" style={{ color: COLORS.muted }}>
            Charges this show adds to everyone who enters a class — a drug fee, a
            gate fee, an association or judge fee. Each is billed automatically;
            nothing here is something the exhibitor picks.
          </p>
        </div>
        {!showAddForm && (
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="text-xs px-3 py-1.5 rounded border hover:bg-amber-50 whitespace-nowrap"
            style={{ borderColor: COLORS.border, color: COLORS.accent }}
          >
            + Add a fee
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {judgePanelMissing && (
        <p
          className="text-xs rounded border px-3 py-2"
          style={{ borderColor: '#d9a441', backgroundColor: '#fdf8eb', color: '#5c3d1e' }}
        >
          A per-judge fee multiplies by the judges on the panel, and this show has
          none assigned yet — so it is billing nothing.{' '}
          {judgesHref && (
            <a href={judgesHref} className="underline">
              Assign judges
            </a>
          )}
        </p>
      )}

      {charges.length === 0 ? (
        <p className="text-sm italic" style={{ color: COLORS.muted }}>
          No extra fees. Most shows add at least one — a drug or office fee per
          horse is the usual example.
        </p>
      ) : (
        <ul className="divide-y" style={{ borderColor: COLORS.soft }}>
          {charges.map((charge) => {
            const draft = draftFor(charge);
            const cents = centsFromDollars(draft.amount);
            const invalid = cents === null;
            const dirty =
              !invalid &&
              (cents !== charge.amount_cents ||
                draft.label !== charge.label ||
                draft.unit !== charge.unit ||
                (draft.notes.trim() || null) !== (charge.notes ?? null));
            return (
              <li key={charge.id} className="py-2.5 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    value={draft.label}
                    onChange={(e) => patchDraft(charge, { label: e.target.value })}
                    aria-label="Fee name"
                    className="flex-1 min-w-[150px] border rounded px-2 py-1 text-sm"
                    style={{ borderColor: COLORS.border }}
                  />
                  <div className="relative w-24">
                    <span
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-xs"
                      style={{ color: COLORS.muted }}
                    >
                      $
                    </span>
                    <input
                      inputMode="decimal"
                      value={draft.amount}
                      onChange={(e) => patchDraft(charge, { amount: e.target.value })}
                      aria-label="Amount"
                      className="w-full border rounded pl-5 pr-2 py-1 text-sm"
                      style={{ borderColor: invalid ? '#fca5a5' : COLORS.border }}
                    />
                  </div>
                  <BasisSelect
                    value={draft.unit}
                    onChange={(unit) => patchDraft(charge, { unit })}
                  />
                  <button
                    type="button"
                    onClick={() => save(charge)}
                    disabled={busyId === charge.id || invalid || !dirty}
                    className="text-xs px-2 py-1 rounded font-medium disabled:opacity-40"
                    style={{ color: COLORS.accent }}
                    title={!dirty ? 'No change' : invalid ? 'Invalid amount' : 'Save'}
                  >
                    {busyId === charge.id ? '…' : 'Save'}
                  </button>
                  {confirmDeleteId === charge.id ? (
                    <span className="flex items-center gap-1 text-xs">
                      <button
                        type="button"
                        onClick={() => remove(charge)}
                        className="text-red-600 hover:underline"
                        disabled={busyId === charge.id}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="hover:underline"
                        style={{ color: COLORS.muted }}
                      >
                        No
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(charge.id)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <p className="text-xs" style={{ color: COLORS.muted }}>
                  {invalid
                    ? 'Enter an amount like 8 or 8.50.'
                    : chargeExplanation(draft.unit, cents ?? 0, judgeCount)}
                </p>
                <input
                  value={draft.notes}
                  onChange={(e) => patchDraft(charge, { notes: e.target.value })}
                  placeholder="Note for the show bill (optional)"
                  aria-label="Notes"
                  className="w-full border rounded px-2 py-1 text-xs"
                  style={{ borderColor: COLORS.soft }}
                />
              </li>
            );
          })}
        </ul>
      )}

      {showAddForm && (
        <div
          className="rounded border p-3 space-y-2"
          style={{ borderColor: COLORS.soft, backgroundColor: COLORS.panel }}
        >
          <p className="text-xs font-semibold" style={{ color: COLORS.text }}>
            New fee
          </p>
          <div className="flex flex-wrap gap-2 items-end">
            <input
              placeholder="Name (e.g. Drug test fee)"
              value={newRow.label}
              onChange={(e) => setNewRow((p) => ({ ...p, label: e.target.value }))}
              aria-label="Fee name"
              className="flex-1 min-w-[160px] border rounded px-2 py-1 text-sm"
              style={{ borderColor: COLORS.border }}
            />
            <div className="relative w-24">
              <span
                className="absolute left-2 top-1/2 -translate-y-1/2 text-xs"
                style={{ color: COLORS.muted }}
              >
                $
              </span>
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={newRow.amount}
                onChange={(e) => setNewRow((p) => ({ ...p, amount: e.target.value }))}
                aria-label="Amount"
                className="w-full border rounded pl-5 pr-2 py-1 text-sm"
                style={{ borderColor: COLORS.border }}
              />
            </div>
            <BasisSelect
              value={newRow.unit}
              onChange={(unit) => setNewRow((p) => ({ ...p, unit }))}
            />
            <button
              type="button"
              onClick={add}
              disabled={adding}
              className="px-3 py-1.5 text-sm rounded font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: COLORS.accent }}
            >
              {adding ? 'Adding…' : 'Add'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddForm(false);
                setNewRow({ label: '', amount: '', unit: 'per_horse', notes: '' });
                setError(null);
              }}
              className="text-xs hover:underline"
              style={{ color: COLORS.muted }}
            >
              Cancel
            </button>
          </div>
          <p className="text-xs" style={{ color: COLORS.muted }}>
            {chargeExplanation(newRow.unit, centsFromDollars(newRow.amount) ?? 0, judgeCount)}
          </p>
          <input
            value={newRow.notes}
            onChange={(e) => setNewRow((p) => ({ ...p, notes: e.target.value }))}
            placeholder="Note for the show bill (optional)"
            aria-label="Notes"
            className="w-full border rounded px-2 py-1 text-xs"
            style={{ borderColor: COLORS.soft }}
          />
        </div>
      )}

      <p className="text-xs" style={{ color: COLORS.muted }}>
        {judgeCount === 0
          ? 'No judges assigned yet.'
          : `${judgeCount} judge${judgeCount === 1 ? '' : 's'} on the panel.`}{' '}
        Stalls, shavings and camping are booked by the exhibitor and are set up on
        the Lodging &amp; Boarding step instead.
      </p>
    </section>
  );
}
