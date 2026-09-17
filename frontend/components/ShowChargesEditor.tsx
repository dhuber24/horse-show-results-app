'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AutosaveNavLink,
  useRegisterStepAutosave,
} from '@/app/admin/shows/[id]/setup/_lib/StepAutosave';
import {
  CLASS_FEE_EDITOR_UNITS,
  chargesNobody,
  offersClassList,
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
 * One editor, used by setup Step 7 (Fees) and the Entry Fees screen, because both
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
 * and removable; a new show adds one with "+ Add a fee".
 *
 * There are no quick-add presets. A row of six pre-named chips ("Office fee
 * (per horse, per judge)", "All-day fee (per horse, per judge)"…) above the
 * list read as six more fees the show already had, and two of them were the
 * same unit under different names. A fee is a name, an amount and a unit, and
 * the form asks for exactly those.
 *
 * Every automatic charge counts only the breed association's own classes —
 * not ones a club like WSCA or MNSPHC sanctions outright, which already
 * carry their own price. That used to be a checkbox a manager had to tick per
 * fee; it no longer is. Which classes belong to a club is already decided
 * elsewhere (Sanctioned Classes, Step 5) by what the classes themselves say,
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
  /** The classes this fee is narrowed to (migration 137). Empty — the default,
   *  and what almost every fee carries — means every class, including ones
   *  added to the schedule later. Optional so a payload from before the field
   *  existed still parses as every class rather than as none. */
  class_ids?: string[];
};

/** The minimum of a class the scope picker needs. */
export type ScopeClass = { id: string; class_number: string; class_name: string };

/**
 * Which classes a fee uses. `'all'` is every class — what an empty `class_ids`
 * means on the wire, so it keeps covering classes added later. An empty *list*
 * is a manager who unticked Select all and has not ticked anything back yet: a
 * state the screen has to be able to show, and one that cannot be saved,
 * because sending `[]` would say "every class" while every box reads unticked.
 */
type ClassScope = 'all' | string[];

type Draft = {
  label: string;
  amount: string;
  unit: FeeUnit;
  notes: string;
  scope: ClassScope;
};

const EMPTY_DRAFT: Draft = { label: '', amount: '', unit: 'per_horse', notes: '', scope: 'all' };

const COLORS = {
  text: 'var(--foreground)',
  muted: 'var(--muted)',
  border: 'var(--border)',
  soft: 'var(--border-subtle)',
  accent: 'var(--accent)',
  panel: 'var(--background)',
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

/** A class scope is a set, so order is not a change. Comparing the arrays
 *  directly would call a row dirty for having been re-ticked in a different
 *  sequence, and the step autosave would then rewrite a row nobody edited. */
function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

function draftFromCharge(charge: ShowCharge): Draft {
  const ids = charge.class_ids ?? [];
  return {
    label: charge.label,
    amount: dollarsFromCents(charge.amount_cents),
    unit: charge.unit,
    notes: charge.notes ?? '',
    scope: ids.length > 0 ? ids : 'all',
  };
}

/**
 * Whether a row shows the class list.
 *
 * On a fee quoted per class, always. On any other unit, only while the saved
 * row already carries a list under that same unit: migration 137 offered one on
 * every automatic charge, billing still honours it, and a list narrowing a bill
 * with nothing on screen to see or clear it is worse than a list the manager did
 * not need. Switching the unit away drops it, and the save clears it.
 */
function scopeOffered(unit: FeeUnit, charge?: ShowCharge): boolean {
  if (offersClassList(unit)) return true;
  return !!charge && unit === charge.unit && (charge.class_ids ?? []).length > 0;
}

/** The `class_ids` a draft would save — `[]` for every class — or null when it
 *  cannot be saved because every class is unticked. A unit that shows no list
 *  saves `[]`, so a fee moved off a per-class unit keeps no list nobody can see. */
function classIdsToSend(draft: Draft, charge?: ShowCharge): string[] | null {
  if (!scopeOffered(draft.unit, charge) || draft.scope === 'all') return [];
  return draft.scope.length > 0 ? draft.scope : null;
}

/** Why a draft cannot be saved, or null when it can. Read by the Save button's
 *  tooltip and by `save` and `add` — and through them by the step's autosave —
 *  so all of them refuse for the same reason in the same words. */
function draftProblem(draft: Draft, charge?: ShowCharge): string | null {
  const name = draft.label.trim();
  if (!name) return 'A fee needs a name — it is what the exhibitor reads on their bill.';
  if (centsFromDollars(draft.amount) === null) return `Invalid amount for ${name}.`;
  if (classIdsToSend(draft, charge) === null) {
    return `Tick at least one class for ${name}, or Select all.`;
  }
  return null;
}

/**
 * Whether a row's draft differs from what is on file, valid or not. The per-row
 * Save button and the step's autosave read the same test, so a row the button
 * calls unchanged is one the autosave leaves alone.
 *
 * Validity is deliberately not part of it. An edit that cannot be saved — an
 * amount of "8.5.0", every class unticked — is still an edit, and the autosave
 * has to attempt it and stop the navigation on the error; calling it clean
 * would carry the manager to the next step and quietly drop what they typed.
 * Every class unticked is always an edit, since nothing is ever saved that way.
 */
function isDirty(charge: ShowCharge, draft: Draft): boolean {
  const ids = classIdsToSend(draft, charge);
  return (
    centsFromDollars(draft.amount) !== charge.amount_cents ||
    draft.label !== charge.label ||
    draft.unit !== charge.unit ||
    (draft.notes.trim() || null) !== (charge.notes ?? null) ||
    ids === null ||
    !sameIds(ids, charge.class_ids ?? [])
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
      return `${rate} per class, printed on the show bill only — it charges nobody.`;
    case 'per_class_per_horse':
      return `${rate} per class, per horse, printed on the show bill only — it charges nobody.`;
    default:
      return '';
  }
}

/**
 * Said on the row, in words, for a fee that charges nobody.
 *
 * It used to be only the unit picker's tooltip. A per-class fee offers a list
 * of classes to tick, which reads exactly like pricing those classes — and a
 * manager who did that, entered somebody in one and looked at the desk saw $0,
 * because what an entry is charged is its class's own entry fee. The note is
 * warning-coloured rather than grey because it contradicts what the controls
 * beside it suggest, and it links to where a class's price is actually set.
 */
function ChargesNobodyNote({ classPricesHref }: { classPricesHref?: string }) {
  return (
    <p className="text-xs" style={{ color: 'var(--warning)' }}>
      Show bill only — this doesn’t charge anyone. An entry is charged its class’s own entry
      fee
      {classPricesHref ? (
        <>
          .{' '}
          <AutosaveNavLink
            href={classPricesHref}
            className="underline font-medium"
            style={{ color: 'var(--warning)' }}
          >
            Set class prices →
          </AutosaveNavLink>
        </>
      ) : (
        ', set in the class list below.'
      )}
    </p>
  );
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

/**
 * Which classes one fee applies to (migration 137).
 *
 * **Every class is ticked by default**, and the manager narrows a fee by
 * unticking — every box ticked under a ticked Select all, so nobody has to do
 * anything for a fee that covers the whole schedule.
 *
 * **It opens the moment a per-class unit is picked** (`defaultOpen`), on a new
 * fee and when a saved fee's unit is changed to one. Choosing "per class" is
 * the manager asking which classes; a collapsed one-line toggle under the row
 * read as though no list existed. A fee that loads already per class starts
 * closed, so a dozen of them do not bury the page in class lists.
 *
 * Every class ticked is saved as `'all'` (`class_ids: []`), never as a list of
 * every id: a list would quietly leave out the next class added to the
 * schedule, where "every class" covers it. So ticking the last unticked box
 * goes back to `'all'` too.
 */
function ClassScopePicker({
  classes,
  scope,
  onChange,
  defaultOpen = false,
  disabled,
}: {
  classes: ScopeClass[];
  scope: ClassScope;
  onChange: (scope: ClassScope) => void;
  defaultOpen?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const all = scope === 'all';
  const chosen = new Set(all ? classes.map((c) => c.id) : scope);
  const chosenCount = classes.filter((c) => chosen.has(c.id)).length;
  const none = !all && scope.length === 0;

  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(classes.every((c) => next.has(c.id)) ? 'all' : [...next]);
  };

  const status = all
    ? 'all classes'
    : none
      ? 'no classes ticked'
      : `${chosenCount} of ${classes.length} class${classes.length === 1 ? '' : 'es'}`;

  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-expanded={open}
        className="font-medium hover:underline disabled:opacity-50"
        style={{ color: COLORS.accent }}
        title={
          disabled
            ? 'Saving this fee'
            : all
              ? 'This fee uses every class, including ones added later. Untick classes to narrow it.'
              : 'Exhibitors who enter none of the ticked classes owe nothing for this fee.'
        }
      >
        <span aria-hidden>{open ? '▾' : '▸'}</span> Choose which classes use the fee
      </button>{' '}
      <span className={none ? 'text-red-600' : undefined} style={none ? undefined : { color: COLORS.muted }}>
        · {status}
      </span>

      {open && (
        <div
          className="mt-1 rounded border p-2 space-y-1 max-h-56 overflow-y-auto"
          style={{ borderColor: COLORS.border, backgroundColor: 'var(--background)' }}
        >
          {classes.length === 0 ? (
            <p style={{ color: COLORS.muted }}>
              No classes on the schedule yet — this fee will use every class you add.
            </p>
          ) : (
            <>
              <label
                className="flex items-center gap-2 pb-1 mb-1 border-b cursor-pointer font-medium"
                style={{ borderColor: COLORS.soft, color: COLORS.text }}
              >
                <input
                  type="checkbox"
                  checked={all}
                  ref={(el) => {
                    if (el) el.indeterminate = chosenCount > 0 && !all;
                  }}
                  onChange={() => onChange(all ? [] : 'all')}
                />
                Select all
              </label>
              {none && (
                <p className="text-red-600">Tick at least one class, or Select all.</p>
              )}
              {classes.map((c) => (
                <label key={c.id} className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={chosen.has(c.id)}
                    onChange={() => toggle(c.id)}
                    className="mt-0.5"
                  />
                  <span style={{ color: COLORS.text }}>
                    <span className="font-mono mr-1" style={{ color: 'var(--accent)' }}>
                      {c.class_number}
                    </span>
                    {c.class_name}
                  </span>
                </label>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function ShowChargesEditor({
  showId,
  initialCharges,
  judgeCount,
  judgesHref,
  classPricesHref,
  classes = [],
  boxed = true,
}: {
  showId: string;
  initialCharges: ShowCharge[];
  /** The show's classes, for narrowing a per-class fee to some of them
   *  (migration 137). Empty is not a fault — the fees step comes after the
   *  Class Builder, but somebody can still reach it before building a schedule
   *  — and the picker says the fee will use every class that gets added. */
  classes?: ScopeClass[];
  /** How many judges are on this show's panel. A per-judge charge multiplies by
   *  it, so a show with none assigned yet bills nothing for one — which the
   *  screen says outright rather than leaving the manager to discover it on
   *  somebody's bill. */
  judgeCount: number;
  /** Where to go and fix an empty panel. */
  judgesHref?: string;
  /** Where a class's own price is set, linked from the note on a fee that
   *  charges nobody. Omitted where that table is on the same screen (Entry
   *  Fees), and the note points down the page instead. */
  classPricesHref?: string;
  /** False when a parent already renders the outer "Class Fees" box (Entry
   *  Fees, which also holds the per-class pricing table below this) — skips
   *  this component's own border and top-level heading so there is exactly
   *  one box, not two. Defaults to true for the fees step, which has no per-class
   *  table and owns nothing else to share a box with. */
  boxed?: boolean;
}) {
  const router = useRouter();

  const [charges, setCharges] = useState(initialCharges);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(initialCharges.map((c) => [c.id, draftFromCharge(c)])),
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);

  const draftFor = (charge: ShowCharge): Draft => drafts[charge.id] ?? draftFromCharge(charge);

  const patchDraft = (charge: ShowCharge, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [charge.id]: { ...draftFor(charge), ...patch } }));

  /** Returns whether the row was written. The step's autosave stops the
   *  navigation on a false, so the manager sees the error rather than being
   *  carried forward from it. */
  async function save(charge: ShowCharge): Promise<boolean> {
    const draft = draftFor(charge);
    const problem = draftProblem(draft, charge);
    const cents = centsFromDollars(draft.amount);
    const classIds = classIdsToSend(draft, charge);
    if (problem || cents === null || classIds === null) {
      setError(problem);
      return false;
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
        // Always sent, so going back to every class is a change the endpoint
        // can see. Omitting it would mean a list could be narrowed and never
        // widened again.
        class_ids: classIds,
      }),
    });
    setBusyId(null);
    if (res.ok) {
      const updated: ShowCharge = await res.json();
      setCharges((prev) => prev.map((c) => (c.id === charge.id ? updated : c)));
      router.refresh();
      return true;
    }
    const err = await res.json().catch(() => ({}));
    setError(err.detail ?? `Failed to save ${draft.label}.`);
    return false;
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

  async function add(): Promise<boolean> {
    const problem = draftProblem(newRow);
    const cents = centsFromDollars(newRow.amount);
    const classIds = classIdsToSend(newRow);
    if (problem || cents === null || classIds === null) {
      setError(problem);
      return false;
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
        class_ids: classIds,
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
      setDrafts((prev) => ({ ...prev, [created.id]: draftFromCharge(created) }));
      setNewRow(EMPTY_DRAFT);
      setShowAddForm(false);
      router.refresh();
      return true;
    }
    const err = await res.json().catch(() => ({}));
    setError(err.detail ?? 'Failed to add that fee.');
    return false;
  }

  // Leaving the step writes the rows the manager edited and never pressed Save
  // on. The open "new fee" form is written too, but only once it has both a
  // name and an amount typed: saving on the name alone would put a $0 fee on
  // the bill for anybody who started typing one and thought better of it.
  useRegisterStepAutosave(async () => {
    for (const charge of charges) {
      if (!isDirty(charge, draftFor(charge))) continue;
      if (!(await save(charge))) throw new Error('A class fee could not be saved.');
    }
    if (showAddForm && newRow.label.trim() && newRow.amount.trim()) {
      if (!(await add())) throw new Error('A class fee could not be added.');
    }
  });

  const judgePanelMissing =
    judgeCount === 0 && charges.some((c) => usesJudgeCount(c.unit) && c.amount_cents > 0);

  const content = (
    <>
      {(boxed || !showAddForm) && (
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          {boxed && (
            <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
              Class Fees
            </h2>
          )}
          {!showAddForm && (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className="ml-auto text-xs px-3 py-1.5 rounded border hover:bg-amber-50 whitespace-nowrap"
              style={{ borderColor: COLORS.border, color: COLORS.accent }}
            >
              + Add a fee
            </button>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      {judgePanelMissing && (
        <p
          className="text-xs rounded border px-3 py-2"
          style={{ borderColor: 'var(--warning)', backgroundColor: 'var(--warning-bg)', color: 'var(--text-deep)' }}
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

      {/* Above the list, not below it. The "+ Add a fee" button is up
          here, so a form that opened at the foot of a
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
              onClick={() => void add()}
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
                setNewRow(EMPTY_DRAFT);
                setError(null);
              }}
              className="text-xs hover:underline"
              style={{ color: COLORS.muted }}
            >
              Cancel
            </button>
          </div>
          {/* Kept as visible text here, where the unit is being chosen — see
              `chargeExplanation`. On a saved row it is the select's tooltip,
              except for a fee that charges nobody, which says so on the row. */}
          {chargesNobody(newRow.unit) ? (
            <ChargesNobodyNote classPricesHref={classPricesHref} />
          ) : (
            <p className="text-xs" style={{ color: COLORS.muted }}>
              {chargeExplanation(newRow.unit, centsFromDollars(newRow.amount) ?? 0, judgeCount)}
            </p>
          )}
          {scopeOffered(newRow.unit) && (
            <ClassScopePicker
              classes={classes}
              scope={newRow.scope}
              onChange={(scope) => setNewRow((p) => ({ ...p, scope }))}
              defaultOpen
            />
          )}
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
            const offered = scopeOffered(draft.unit, charge);
            const problem = draftProblem(draft, charge);
            const dirty = isDirty(charge, draft);
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
                      style={{ borderColor: invalid ? 'var(--error-border)' : COLORS.border }}
                    />
                  </div>
                  <BasisSelect
                    value={draft.unit}
                    onChange={(unit) => patchDraft(charge, { unit })}
                    title={chargeExplanation(draft.unit, cents ?? 0, judgeCount)}
                  />
                  <button
                    type="button"
                    onClick={() => void save(charge)}
                    disabled={busyId === charge.id || !!problem || !dirty}
                    className="text-xs px-2 py-1 rounded font-medium disabled:opacity-40"
                    style={{ color: COLORS.accent }}
                    title={problem ?? (!dirty ? 'No change' : 'Save')}
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
                {chargesNobody(draft.unit) && (
                  <ChargesNobodyNote classPricesHref={classPricesHref} />
                )}
                {offered && (
                  <ClassScopePicker
                    // Keyed on the unit so switching to another per-class unit
                    // re-opens the list too, not only switching onto one.
                    key={draft.unit}
                    classes={classes}
                    scope={draft.scope}
                    onChange={(scope) => patchDraft(charge, { scope })}
                    defaultOpen={draft.unit !== charge.unit}
                    disabled={busyId === charge.id}
                  />
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
    </>
  );

  if (!boxed) {
    return <div className="space-y-3">{content}</div>;
  }

  return (
    <section
      className="p-4 rounded-lg border space-y-3"
      style={{ borderColor: COLORS.border, backgroundColor: 'var(--surface)' }}
    >
      {content}
    </section>
  );
}
