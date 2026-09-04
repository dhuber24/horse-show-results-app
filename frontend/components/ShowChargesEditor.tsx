'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CLASS_FEE_EDITOR_UNITS,
  unitLabel,
  usesJudgeCount,
  type FeeUnit,
} from '@/lib/fee-units';

/**
 * Class Fees — the show's own charges, on top of what each class costs to
 * enter: an office/drug fee, an association assessment, an all-day pass, a
 * jackpot/sidepot fee published on the bill. Every exhibitor who entered a
 * class owes the automatic ones whether they asked for them or not; a
 * `per_entry` row like a jackpot is published text only and bills nobody
 * here — the pot's own buy-in is what actually charges anyone.
 *
 * One editor, used by setup Step 5 and the Entry Fees screen, because both
 * were writing the same `show_fees` rows with different vocabulary. There is
 * one place these rows are shaped, and one box they live in — a class fee
 * does not get a second home outside it. `boxed` lets a caller that already
 * owns an outer "Class Fees" box (Entry Fees, which also holds the per-class
 * pricing table) render this without a second border and a second heading.
 *
 * The office charge is one of these rows (migration 132) and has no special
 * control of its own. It was `shows.office_charge_cents` + a basis column,
 * which meant a bespoke box, bespoke state and a bespoke save button for a
 * charge that is, to an exhibitor's bill, a `per_exhibitor` or `per_horse` fee
 * like any other. A converted show has an "Office charge" row here, renamable
 * and removable; a new show adds one from the quick-add presets.
 *
 * Every automatic charge counts only the breed association's own classes —
 * not ones a club like WSCA or MNSPHC sanctions outright, which already
 * carry their own price. That used to be a checkbox a manager had to tick per
 * fee; it no longer is. Which classes belong to a club is already decided
 * elsewhere (Sanctioned Classes, Step 6) by what the classes themselves say,
 * so there was nothing left for a second, fee-level toggle to add.
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

type Draft = {
  label: string;
  amount: string;
  unit: FeeUnit;
  notes: string;
};

/**
 * Starting points for the class fees a manager asks for most, offered as
 * one-click presets rather than left for them to find in a unit dropdown.
 *
 * `per_judge_per_horse` and `per_judge_per_entry` compute exactly the two
 * examples "by horse and by judge at once" usually means — one horse at a
 * four-judge show is $3 × 1 × 4 = $12 either way the office charges it, and
 * the difference is whether it multiplies by horses brought or by classes
 * entered. All four units existed already; what did not exist was a place
 * that named them apart from a list of six.
 */
const QUICK_ADD_PRESETS: {
  label: string;
  unit: FeeUnit;
  notes?: string;
  blurb: string;
}[] = [
  // The two shapes the old `shows.office_charge_basis` column offered, now
  // just two presets: `per_back_number` was `per_exhibitor` and `per_horse`
  // was `per_horse` (migration 132).
  {
    label: 'Office fee (per exhibitor)',
    unit: 'per_exhibitor',
    blurb: 'Once per exhibitor, however many horses they bring — one back number, one charge.',
  },
  {
    label: 'Office fee (per horse)',
    unit: 'per_horse',
    blurb: 'Once for each horse entered — the usual drug/office fee.',
  },
  {
    label: 'Office fee (per horse, per judge)',
    unit: 'per_judge_per_horse',
    blurb: 'One horse at a 4-judge show is ×4 — see the math below once you set an amount.',
  },
  {
    label: 'Association assessment (per judge, per class)',
    unit: 'per_judge_per_entry',
    blurb: "The breed body's own per-class levy (e.g. APHA SC-125.B) — counts classes entered, in the breed association's own classes.",
  },
  // Named for what a real show bill already called it by hand: a flat charge
  // per horse per judge that covers a horse for every class it enters that
  // day, as against a per-class fee.
  {
    label: 'All-day fee (per horse, per judge)',
    unit: 'per_judge_per_horse',
    blurb: 'A flat charge per horse per judge, covering every class that horse enters that day.',
  },
  {
    label: 'Jackpot / sidepot fee',
    unit: 'per_entry',
    notes: 'Published on the show bill only — the buy-in is set on the side pot itself.',
    blurb: 'Not billed here. A side pot bundles the classes you pick for it, and the buy-in that actually bills is set on the pot — this only publishes a price on the bill.',
  },
];

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
 *
 * On a saved row this is the unit select's tooltip rather than a line of text
 * under it. Repeated down a list of eight fees it stopped reading as an
 * explanation and started reading as furniture — and it sat exactly where the
 * show-bill note belongs, so the note looked like more of the same grey prose.
 * It stays as visible text in the new-fee form below, which is the one place
 * the unit is actually being chosen.
 */
function chargeExplanation(unit: string, cents: number, judgeCount: number): string {
  const rate = `$${dollarsFromCents(cents)}`;
  const judges = `${judgeCount} judge${judgeCount === 1 ? '' : 's'}`;
  const scopeNote =
    " — only in the breed association's own classes, not ones a club like WSCA or MNSPHC sanctions outright";
  switch (unit) {
    case 'per_exhibitor':
      return `${rate} once per exhibitor, however many horses they bring${scopeNote}.`;
    case 'per_horse':
      return `${rate} for each horse they enter${scopeNote}.`;
    case 'per_judge_per_exhibitor':
      return judgeCount > 0
        ? `${rate} × ${judges} = $${dollarsFromCents(cents * judgeCount)} per exhibitor${scopeNote}.`
        : `${rate} per judge, charged once per exhibitor${scopeNote}.`;
    case 'per_judge_per_horse':
      return judgeCount > 0
        ? `${rate} × ${judges} = $${dollarsFromCents(
            cents * judgeCount,
          )} for each horse they enter${scopeNote}.`
        : `${rate} per judge, for each horse they enter${scopeNote}.`;
    case 'per_judge_per_entry':
      // No live entry count to multiply by here — unlike horses, classes
      // entered isn't known until someone signs up, so this states the
      // formula rather than a total.
      return judgeCount > 0
        ? `${rate} × ${judges} × classes entered${scopeNote}.`
        : `${rate} per judge, per class entered${scopeNote}.`;
    case 'per_entry':
      return `${rate} published on the show bill only — not billed automatically here.`;
    default:
      return '';
  }
}

function BasisSelect({
  value,
  onChange,
  title,
}: {
  value: FeeUnit;
  onChange: (unit: FeeUnit) => void;
  /** What this row will actually charge, on hover — see `chargeExplanation`. */
  title?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as FeeUnit)}
      aria-label="Charged"
      title={title}
      className="border rounded px-2 py-1 text-sm"
      style={{ borderColor: COLORS.border, color: COLORS.text }}
    >
      {CLASS_FEE_EDITOR_UNITS.map((unit) => (
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
  boxed = true,
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
  /** False when a parent already renders the outer "Class Fees" box (Entry
   *  Fees, which also holds the per-class pricing table below this) — skips
   *  this component's own border and top-level heading so there is exactly
   *  one box, not two. Defaults to true for Step 5, which has no per-class
   *  table and owns nothing else to share a box with. */
  boxed?: boolean;
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

  /** Opens the add-a-fee form pre-filled from a preset — the manager only has
   *  to type the amount. The label (and notes, for Jackpot) is a starting
   *  point, not locked in; they're free to change it before pressing Add. */
  const startQuickAdd = (preset: (typeof QUICK_ADD_PRESETS)[number]) => {
    setNewRow({
      label: preset.label,
      amount: '',
      unit: preset.unit,
      notes: preset.notes ?? '',
    });
    setShowAddForm(true);
    setError(null);
  };

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
        // Top of the list, not the bottom. The fee you have just added is the
        // one you are about to type an amount and a note into, and on a show
        // carrying a dozen charges it appeared below the fold — which reads
        // as nothing having happened. Persisted rather than done in state
        // alone, so the row is still there after a reload; `show_fees` is
        // ordered by `sort_order` then `created_at`. Negative because
        // migration 132's converted office charge sits at -1.
        sort_order: Math.min(0, ...charges.map((c) => c.sort_order)) - 1,
      }),
    });
    setAdding(false);
    if (res.ok) {
      const created: ShowCharge = await res.json();
      setCharges((prev) => [created, ...prev]);
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

  const content = (
    <>
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div>
          {boxed && (
            <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
              Class Fees
            </h2>
          )}
          <p className="text-xs mt-0.5" style={{ color: COLORS.muted }}>
            Charges this show adds on top of each class&apos;s entry fee — an office or
            drug fee, an association assessment, an all-day pass, a jackpot/sidepot
            fee. The automatic ones are billed to everyone who enters a class;
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

      {/* Named starting points for the class fees this box gets asked for
          most — a manager wanting one does not have to already know which of
          six units means it. Picking one opens the form below with the unit
          (and, for Jackpot, the notes) set; only the amount is left to type. */}
      {!showAddForm && (
        <div className="flex flex-wrap gap-1.5">
          {QUICK_ADD_PRESETS.map((preset) => (
            <button
              key={preset.unit + preset.label}
              type="button"
              onClick={() => startQuickAdd(preset)}
              title={preset.blurb}
              className="text-xs px-2.5 py-1 rounded-full border hover:bg-amber-50 whitespace-nowrap"
              style={{ borderColor: COLORS.soft, color: COLORS.muted }}
            >
              + {preset.label}
            </button>
          ))}
        </div>
      )}

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

      {/* Above the list, not below it. The "+ Add a fee" button and the
          quick-add chips are up here, so a form that opened at the foot of a
          dozen rows put the thing you just asked for out of sight — and the
          row it creates now lands directly beneath it. */}
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
          {/* Kept as visible text here, where the unit is being chosen — see
              `chargeExplanation`. On a saved row it is the select's tooltip. */}
          <p className="text-xs" style={{ color: COLORS.muted }}>
            {chargeExplanation(newRow.unit, centsFromDollars(newRow.amount) ?? 0, judgeCount)}
          </p>
          <label className="block text-xs" style={{ color: COLORS.muted }}>
            Note for the show bill (optional)
            <input
              value={newRow.notes}
              onChange={(e) => setNewRow((p) => ({ ...p, notes: e.target.value }))}
              placeholder="e.g. APHA classes only — All Breed classes are not included"
              className="mt-0.5 w-full border rounded px-2 py-1 text-xs"
              style={{ borderColor: COLORS.soft, color: COLORS.text }}
            />
          </label>
        </div>
      )}

      {charges.length === 0 ? (
        <p className="text-sm italic" style={{ color: COLORS.muted }}>
          No class fees yet. Most shows add at least one — a drug or office fee per
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
                    title={chargeExplanation(draft.unit, cents ?? 0, judgeCount)}
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
                {invalid && (
                  <p className="text-xs text-red-600">
                    Enter an amount like 8 or 8.50.
                  </p>
                )}
                <label className="block text-xs" style={{ color: COLORS.muted }}>
                  Note for the show bill (optional)
                  <input
                    value={draft.notes}
                    onChange={(e) => patchDraft(charge, { notes: e.target.value })}
                    placeholder="e.g. APHA classes only — All Breed classes are not included"
                    className="mt-0.5 w-full border rounded px-2 py-1 text-xs"
                    style={{ borderColor: COLORS.soft, color: COLORS.text }}
                  />
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs" style={{ color: COLORS.muted }}>
        {judgeCount === 0
          ? 'No judges assigned yet.'
          : `${judgeCount} judge${judgeCount === 1 ? '' : 's'} on the panel.`}{' '}
        Stalls, shavings and camping are booked by the exhibitor and are set up on
        the Lodging &amp; Boarding step instead.
      </p>
    </>
  );

  if (!boxed) {
    return <div className="space-y-3">{content}</div>;
  }

  return (
    <section
      className="p-4 rounded-lg border space-y-3"
      style={{ borderColor: COLORS.border, backgroundColor: '#fff' }}
    >
      {content}
    </section>
  );
}
