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
 * The office charge on the show row is not *edited* here — it is a column on
 * `shows`, not a fee row, and each caller still owns its own control and save
 * timing for it (`EntryFeesEditor` saves it the moment you press Save;
 * `FeesClient` batches it into the setup step's own Save button). What moved
 * is where that control *renders*: it used to sit in a separate bordered box
 * above this one, on the reasoning that it is a different kind of row. To an
 * exhibitor's bill it is not — it is one more charge added to everyone who
 * enters a class, sitting right next to a drug fee or an assessment doing the
 * same job — so a manager configuring "what does this show add on top" was
 * looking at two boxes for one question. `officeChargeSection` is the
 * caller's own markup, rendered inside this box instead of its own.
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
  /** Whether this charge counts only the breed association's own classes
   *  (migration 130) — see the checkbox below. `per_judge_per_entry` scopes
   *  itself regardless of this value; it only changes anything on the other
   *  automatic units. */
  breed_association_only: boolean;
};

type Draft = {
  label: string;
  amount: string;
  unit: FeeUnit;
  notes: string;
  breedAssociationOnly: boolean;
};

/**
 * The three shapes a "per horse and per judge" question actually turns out
 * to be, offered as one-click starting points rather than left for a manager
 * to find in a generic unit dropdown.
 *
 * `per_judge_per_horse` and `per_judge_per_entry` already compute exactly the
 * two examples a manager asking for "by horse and by judge at once" usually
 * means — one horse at a four-judge show is $3 × 1 × 4 = $12 either way the
 * office charges it, and the difference is whether it multiplies by horses
 * brought or by classes entered. Both units existed before this row did; what
 * did not exist was a place that named the two apart from a list of eleven.
 */
const QUICK_ADD_PRESETS: {
  label: string;
  unit: FeeUnit;
  breedAssociationOnly?: boolean;
  blurb: string;
}[] = [
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
    label: 'Association assessment (per judge, per entry)',
    unit: 'per_judge_per_entry',
    blurb: "The breed body's own per-entry levy (e.g. APHA SC-125.B) — counts classes entered, only in the breed association's own classes.",
  },
  // Named for what a real show bill already called it by hand: a flat charge
  // per horse per judge that covers a horse for every class it enters that
  // day, as against a per-class fee. Ticks "breed association's own classes"
  // by default because that show's version explicitly excluded All Breed
  // (club) classes in a hand-typed note — untick it if this show's version
  // should not.
  {
    label: 'All-day fee (per horse, per judge, breed classes only)',
    unit: 'per_judge_per_horse',
    breedAssociationOnly: true,
    blurb: 'A flat charge per horse per judge, covering every class that horse enters — counted only against horses in the breed association\'s own classes.',
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
 */
function chargeExplanation(
  unit: string,
  cents: number,
  judgeCount: number,
  breedAssociationOnly: boolean,
): string {
  const rate = `$${dollarsFromCents(cents)}`;
  const judges = `${judgeCount} judge${judgeCount === 1 ? '' : 's'}`;
  // per_judge_per_entry is always scoped, regardless of what the checkbox
  // says — that unit is the breed body's own per-entry assessment (e.g. APHA
  // SC-125.B) by definition. Every other unit only gets the note when the
  // show has explicitly ticked the box.
  const scoped = unit === 'per_judge_per_entry' || breedAssociationOnly;
  const scopeNote = scoped
    ? " — only the breed association's own classes, not ones a club like WSCA or MNSPHC sanctions outright"
    : '';
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
  officeChargeSection,
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
  /** The office charge control, rendered inside this box instead of its own.
   *  The caller keeps its own state, save button and timing — this only
   *  changes where the markup sits, so `EntryFeesEditor` can keep saving on
   *  press and `FeesClient` can keep batching it with the rest of the step. */
  officeChargeSection?: React.ReactNode;
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
          breedAssociationOnly: c.breed_association_only,
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
    breedAssociationOnly: false,
  });
  const [error, setError] = useState<string | null>(null);

  /** Opens the add-a-fee form pre-filled from a preset — the manager only has
   *  to type the amount. The label is a starting point, not locked in;
   *  they're free to rename it before pressing Add. */
  const startQuickAdd = (preset: (typeof QUICK_ADD_PRESETS)[number]) => {
    setNewRow({
      label: preset.label,
      amount: '',
      unit: preset.unit,
      notes: '',
      breedAssociationOnly: preset.breedAssociationOnly ?? false,
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
      breedAssociationOnly: charge.breed_association_only,
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
        breed_association_only: draft.breedAssociationOnly,
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
        breed_association_only: newRow.breedAssociationOnly,
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
          breedAssociationOnly: created.breed_association_only,
        },
      }));
      setNewRow({ label: '', amount: '', unit: 'per_horse', notes: '', breedAssociationOnly: false });
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
      {officeChargeSection && (
        <div className="pb-3 border-b space-y-3" style={{ borderColor: COLORS.soft }}>
          {officeChargeSection}
        </div>
      )}
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

      {/* Named starting points for the two "by horse and by judge at once"
          questions this box gets asked most — a manager wanting either does
          not have to already know which of eleven units means it. Picking one
          opens the form below with the unit set; only the amount is left to
          type. */}
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
                draft.breedAssociationOnly !== charge.breed_association_only ||
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
                {draft.unit !== 'per_judge_per_entry' && (
                  <label className="flex items-center gap-1.5 text-xs" style={{ color: COLORS.muted }}>
                    <input
                      type="checkbox"
                      checked={draft.breedAssociationOnly}
                      onChange={(e) => patchDraft(charge, { breedAssociationOnly: e.target.checked })}
                    />
                    Only the breed association&apos;s own classes — not ones a club sanctions outright
                  </label>
                )}
                <p className="text-xs" style={{ color: COLORS.muted }}>
                  {invalid
                    ? 'Enter an amount like 8 or 8.50.'
                    : chargeExplanation(draft.unit, cents ?? 0, judgeCount, draft.breedAssociationOnly)}
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
            {newRow.unit !== 'per_judge_per_entry' && (
              <label className="flex items-center gap-1.5 text-xs" style={{ color: COLORS.muted }}>
                <input
                  type="checkbox"
                  checked={newRow.breedAssociationOnly}
                  onChange={(e) =>
                    setNewRow((p) => ({ ...p, breedAssociationOnly: e.target.checked }))
                  }
                />
                Breed association&apos;s classes only
              </label>
            )}
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
                setNewRow({ label: '', amount: '', unit: 'per_horse', notes: '', breedAssociationOnly: false });
                setError(null);
              }}
              className="text-xs hover:underline"
              style={{ color: COLORS.muted }}
            >
              Cancel
            </button>
          </div>
          <p className="text-xs" style={{ color: COLORS.muted }}>
            {chargeExplanation(
              newRow.unit,
              centsFromDollars(newRow.amount) ?? 0,
              judgeCount,
              newRow.breedAssociationOnly,
            )}
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
