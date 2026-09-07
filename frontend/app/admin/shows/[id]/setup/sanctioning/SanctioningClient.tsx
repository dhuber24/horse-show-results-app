'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  CLUB_SANCTION_UNITS,
  unitLabel,
  usesJudgeCount,
  type ClubSanctionUnit,
} from '@/lib/fee-units';
import { useRegisterStepAutosave } from '../_lib/StepAutosave';

/**
 * Club sanctioning, whole.
 *
 * A club sanction is three facts and they were on three screens: *which clubs*
 * (this step), *what each charges per class* (a box on the fees step) and
 * *which classes each one approves* (a screen hanging off the class list). None
 * of the three charges anybody on its own — a $3 per-class fee against zero
 * approved classes is indistinguishable from a working sanction — and a manager
 * had to visit all three, in an order nothing told them, to end up with money
 * that bills.
 *
 * So they are one step, in the order the answers come: pick the clubs, price
 * each one, tick its classes. It sits after the Class Builder because two of
 * the three questions cannot be answered before there is a schedule.
 *
 * Pricing a club is an amount *and* a unit (migration 133), the same pair Step
 * 4 asks for on the show's own class fees and drawn from the same vocabulary.
 * Per class was the only thing a club could charge until then, so an all-day
 * fee per horse or a per-judge assessment had to be worked out by hand into a
 * flat number — or left off the app. Whichever unit is picked, the charge is
 * counted over the classes ticked below and nowhere else, which is why the two
 * questions stay on one screen.
 *
 * One Save button for the step, and leaving the step saves it too — see
 * `setup/_lib/StepAutosave.tsx`. Membership and fees go first (`PUT
 * /shows/{id}/sanctioning` replaces the whole set), then each club's class
 * list: designating a class for a club the show does not carry is a 404, so
 * the enrolment has to land first.
 */

export type AssociationOption = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

export type ShowSanctioningRow = {
  association_id: string;
  code: string;
  name: string;
  fee_amount_cents: number;
  /** What that amount counts. `per_entry` — per class entered — is what every
   *  club charged before migration 133 and is still the default. */
  fee_unit: ClubSanctionUnit;
};

export type ClassSanctioningRow = {
  association_id: string;
  code: string;
  name: string;
  fee_amount_cents: number;
  fee_unit: ClubSanctionUnit;
  class_ids: string[];
};

export type SanctionedClass = {
  id: string;
  class_number: string;
  class_name: string;
  class_date: string;
  entry_fee_cents: number;
};

const COLORS = {
  text: 'var(--foreground)',
  muted: 'var(--muted)',
  border: 'var(--border)',
  borderSoft: 'var(--bg-subtle)',
  bg: 'var(--surface)',
  warn: 'var(--text-deep)',
  warnSoft: 'var(--warning-bg)',
} as const;

function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function dollarsToCents(input: string): number {
  const n = Number.parseFloat(input);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * What this club's fee will actually charge, spelled out.
 *
 * The same job `chargeExplanation` does in the Class Fees box, and for the same
 * reason: a rate and a unit do not tell a manager what they just set up, and
 * the number they are checking against a paper show bill is the product. The
 * approved-class count is in every sentence because it is the other half of
 * every one of these charges — a $45 all-day fee against zero ticked classes
 * charges nobody, and is indistinguishable from a working sanction otherwise.
 */
function sanctionExplanation(
  unit: ClubSanctionUnit,
  cents: number,
  approved: number,
  judgeCount: number,
): string {
  if (cents === 0) {
    return 'No fee set — ticking classes for this club charges nobody.';
  }
  const rate = formatMoney(cents);
  const classes = `${approved} approved class${approved === 1 ? '' : 'es'}`;
  if (approved === 0) {
    return `${rate} ${unitLabel(unit)}, on no classes yet — tick its classes below.`;
  }
  if (usesJudgeCount(unit) && judgeCount === 0) {
    return `${rate} per judge, and this show has no judges assigned yet — so it is charging nothing.`;
  }
  switch (unit) {
    case 'per_entry':
      return `${rate} × ${classes} = ${formatMoney(cents * approved)} on an entry in every one.`;
    case 'per_exhibitor':
      return `${rate} once per exhibitor who enters any of its ${classes}, however many horses they bring.`;
    case 'per_horse':
      return `${rate} for each horse they enter in its ${classes}.`;
    case 'per_judge_per_exhibitor':
      return `${rate} × ${judgeCount} judge${judgeCount === 1 ? '' : 's'} = ${formatMoney(
        cents * judgeCount,
      )} per exhibitor who enters any of its ${classes}.`;
    case 'per_judge_per_horse':
      return `${rate} × ${judgeCount} judge${judgeCount === 1 ? '' : 's'} = ${formatMoney(
        cents * judgeCount,
      )} for each horse they enter in its ${classes}.`;
    default:
      return '';
  }
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

export default function SanctioningClient({
  showId,
  associations,
  current,
  classSanctioning,
  classes,
  judgeCount,
}: {
  showId: string;
  associations: AssociationOption[];
  current: ShowSanctioningRow[];
  /** Which classes each enrolled club already approves. */
  classSanctioning: ClassSanctioningRow[];
  classes: SanctionedClass[];
  /** How many judges are on this show's panel. A club charging per judge
   *  multiplies by it, so a show with none assigned yet charges nothing for
   *  one — which the screen says outright rather than leaving the manager to
   *  find out on somebody's bill. Same reasoning as the Class Fees box. */
  judgeCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [pickedIds, setPickedIds] = useState<Set<string>>(
    () => new Set(current.map((c) => c.association_id)),
  );
  const [savedPicked, setSavedPicked] = useState<Set<string>>(
    () => new Set(current.map((c) => c.association_id)),
  );

  const [fees, setFees] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      current.map((c) => [c.association_id, centsToDollars(c.fee_amount_cents)]),
    ),
  );
  const [savedFees, setSavedFees] = useState<Record<string, number>>(() =>
    Object.fromEntries(current.map((c) => [c.association_id, c.fee_amount_cents])),
  );

  const [units, setUnits] = useState<Record<string, ClubSanctionUnit>>(() =>
    Object.fromEntries(current.map((c) => [c.association_id, c.fee_unit])),
  );
  const [savedUnits, setSavedUnits] = useState<Record<string, ClubSanctionUnit>>(() =>
    Object.fromEntries(current.map((c) => [c.association_id, c.fee_unit])),
  );

  /** A club the show has just ticked has no row yet, so it charges per class —
   *  the pre-133 behaviour, and the answer for most clubs. */
  function unitFor(id: string): ClubSanctionUnit {
    return units[id] ?? 'per_entry';
  }

  const [classPicks, setClassPicks] = useState<Record<string, Set<string>>>(() =>
    Object.fromEntries(
      classSanctioning.map((c) => [c.association_id, new Set(c.class_ids)]),
    ),
  );
  const [savedClassPicks, setSavedClassPicks] = useState<Record<string, Set<string>>>(
    () =>
      Object.fromEntries(
        classSanctioning.map((c) => [c.association_id, new Set(c.class_ids)]),
      ),
  );

  const [requestOpen, setRequestOpen] = useState(false);
  const [requestName, setRequestName] = useState('');
  const [requestNotes, setRequestNotes] = useState('');
  const [requestSent, setRequestSent] = useState(false);

  const byId = useMemo(
    () => new Map(associations.map((a) => [a.id, a])),
    [associations],
  );
  const picked = useMemo(
    () => associations.filter((a) => pickedIds.has(a.id)),
    [associations, pickedIds],
  );

  function togglePick(id: string) {
    setSuccessMsg(null);
    setPickedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function classPicksFor(id: string): Set<string> {
    return classPicks[id] ?? new Set<string>();
  }

  function setClassPicksFor(id: string, next: Set<string>) {
    setSuccessMsg(null);
    setClassPicks((prev) => ({ ...prev, [id]: next }));
  }

  const membershipDirty = !sameSet(pickedIds, savedPicked);
  const feesDirty = Array.from(pickedIds).some(
    (id) =>
      dollarsToCents(fees[id] ?? '0') !== (savedFees[id] ?? 0) ||
      unitFor(id) !== (savedUnits[id] ?? 'per_entry'),
  );
  const dirtyClubs = Array.from(pickedIds).filter(
    (id) => !sameSet(classPicksFor(id), savedClassPicks[id] ?? new Set()),
  );
  const dirty = membershipDirty || feesDirty || dirtyClubs.length > 0;

  /**
   * Write whatever has changed. Throws on a failure so the step's autosave
   * leaves the manager on the screen with the error rather than carrying them
   * forward from it; the Save button catches and shows the same message.
   */
  async function persist(): Promise<void> {
    // The clubs and their rates first — `PUT .../sanctioning` replaces the full
    // set, so an unticked club is dropped by its absence.
    if (membershipDirty || feesDirty) {
      const res = await fetch(`/api/shows/${showId}/sanctioning`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: Array.from(pickedIds).map((id) => ({
            association_id: id,
            fee_amount_cents: dollarsToCents(fees[id] ?? '0'),
            fee_unit: unitFor(id),
          })),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.detail || 'Failed to save sanctioning.');
      setSavedPicked(new Set(pickedIds));
      setSavedFees(
        Object.fromEntries(
          Array.from(pickedIds).map((id) => [id, dollarsToCents(fees[id] ?? '0')]),
        ),
      );
      setSavedUnits(
        Object.fromEntries(Array.from(pickedIds).map((id) => [id, unitFor(id)])),
      );
    }

    // Then each club's class list. Only clubs still ticked: a club being
    // dropped has just lost its `show_sanctioning` row, and the class endpoint
    // would 404 on it.
    for (const id of dirtyClubs) {
      if (!pickedIds.has(id)) continue;
      const res = await fetch(`/api/shows/${showId}/classes/sanctioning/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ class_ids: Array.from(classPicksFor(id)) }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(
          json?.detail ||
            `Could not save which classes ${byId.get(id)?.code ?? 'that club'} approves.`,
        );
      }
      setSavedClassPicks((prev) => ({ ...prev, [id]: new Set(classPicksFor(id)) }));
    }
  }

  useRegisterStepAutosave(async () => {
    if (!dirty) return;
    setError(null);
    try {
      await persist();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save sanctioning.');
      throw e;
    }
  });

  async function save() {
    setError(null);
    setSuccessMsg(null);
    setBusy(true);
    try {
      await persist();
      setSuccessMsg('Sanctioning saved.');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save sanctioning.');
    } finally {
      setBusy(false);
    }
  }

  async function submitRequest() {
    if (!requestName.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/sanctioned-association-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requested_name: requestName.trim(),
          show_id: showId,
          notes: requestNotes.trim() || null,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.detail || 'Failed to submit request.');
        return;
      }
      setRequestSent(true);
      setRequestOpen(false);
      setRequestName('');
      setRequestNotes('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--error)', backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}
          role="alert"
        >
          {error}
        </div>
      )}
      {successMsg && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--success-border)', backgroundColor: 'var(--success-bg)', color: 'var(--success-strong)' }}
        >
          {successMsg}
        </div>
      )}

      <section
        className="p-4 rounded-lg border space-y-3"
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
      >
        <div>
          <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
            Clubs that sanction this show
          </h2>
          <p className="text-xs mt-0.5" style={{ color: COLORS.muted }}>
            A club&apos;s points apply to the classes it approves, and its fee is
            charged on those classes and nowhere else — per class entered, per
            horse, per exhibitor, or either of those multiplied by the judge
            panel. Tick a club to price it; tick its classes below.
          </p>
        </div>

        {associations.length === 0 ? (
          <p className="text-sm" style={{ color: COLORS.muted }}>
            No sanctioning associations are configured. Request one below.
          </p>
        ) : (
          <ul className="space-y-2">
            {associations.map((a) => {
              const isPicked = pickedIds.has(a.id);
              const feeCents = dollarsToCents(fees[a.id] ?? '0');
              const approved = classPicksFor(a.id).size;
              return (
                <li
                  key={a.id}
                  className="rounded border p-3 space-y-2"
                  style={{
                    borderColor: isPicked ? COLORS.warn : COLORS.border,
                    backgroundColor: isPicked ? COLORS.warnSoft : COLORS.bg,
                  }}
                >
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={isPicked}
                      onChange={() => togglePick(a.id)}
                    />
                    <span style={{ color: COLORS.text }}>
                      <span
                        className="font-mono mr-2 font-semibold"
                        style={{ color: 'var(--accent)' }}
                      >
                        {a.code}
                      </span>
                      {a.name}
                    </span>
                  </label>

                  {isPicked && (
                    <div className="pl-6 flex items-end gap-3 flex-wrap">
                      <label className="block">
                        <span
                          className="block text-xs mb-1"
                          style={{ color: COLORS.muted }}
                        >
                          Fee ($)
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={fees[a.id] ?? ''}
                          onChange={(e) => {
                            setSuccessMsg(null);
                            setFees((prev) => ({ ...prev, [a.id]: e.target.value }));
                          }}
                          className="w-32 border rounded px-3 py-2 text-sm"
                          style={{ borderColor: COLORS.border }}
                          placeholder="e.g. 3.00"
                        />
                      </label>
                      <label className="block">
                        <span
                          className="block text-xs mb-1"
                          style={{ color: COLORS.muted }}
                        >
                          Charged
                        </span>
                        <select
                          value={unitFor(a.id)}
                          onChange={(e) => {
                            setSuccessMsg(null);
                            setUnits((prev) => ({
                              ...prev,
                              [a.id]: e.target.value as ClubSanctionUnit,
                            }));
                          }}
                          /* The sentence beside the row says the same thing;
                             on the control itself it answers the question at
                             the moment the unit is being chosen. */
                          title={sanctionExplanation(
                            unitFor(a.id),
                            feeCents,
                            approved,
                            judgeCount,
                          )}
                          className="border rounded px-2 py-2 text-sm"
                          style={{ borderColor: COLORS.border, color: COLORS.text }}
                        >
                          {CLUB_SANCTION_UNITS.map((unit) => (
                            <option key={unit} value={unit}>
                              {unitLabel(unit)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="text-xs pb-2" style={{ color: COLORS.muted }}>
                        {sanctionExplanation(
                          unitFor(a.id),
                          feeCents,
                          approved,
                          judgeCount,
                        )}
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Which classes each club approves. Nothing to show until a club is
          ticked, and nothing to tick until the schedule exists. */}
      {picked.length > 0 &&
        (classes.length === 0 ? (
          <div
            className="rounded border p-4 text-sm"
            style={{
              borderColor: COLORS.border,
              backgroundColor: COLORS.warnSoft,
              color: COLORS.warn,
            }}
          >
            This show has no classes yet, so there is nothing for a club to approve.
            Build the schedule in{' '}
            <Link
              href={`/admin/shows/${showId}/classes`}
              className="underline"
              style={{ color: 'var(--accent)' }}
            >
              Step 5: Class Builder
            </Link>{' '}
            and come back — the clubs and their rates above save either way.
          </div>
        ) : (
          picked.map((club) => (
            <ClubClassPicker
              key={club.id}
              code={club.code}
              name={club.name}
              feeCents={dollarsToCents(fees[club.id] ?? '0')}
              unit={unitFor(club.id)}
              judgeCount={judgeCount}
              classes={classes}
              selected={classPicksFor(club.id)}
              onChange={(next) => setClassPicksFor(club.id, next)}
            />
          ))
        ))}

      <div className="flex items-center justify-end gap-3">
        <span className="text-xs" style={{ color: COLORS.muted }}>
          {dirty ? 'Unsaved changes — moving on saves them too.' : ' '}
        </span>
        <button
          type="button"
          onClick={save}
          disabled={busy || !dirty}
          title={dirty ? undefined : 'Nothing has changed.'}
          className="text-sm rounded px-4 py-2 disabled:opacity-50"
          style={{ backgroundColor: COLORS.warn, color: 'var(--surface)' }}
        >
          {busy ? 'Saving…' : 'Save sanctioning'}
        </button>
      </div>

      {/* Requesting a club is the rare case — it stays a single line until
          someone asks for it, so the common path owns the screen. */}
      <div>
        {requestSent ? (
          <div
            className="rounded border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--success-border)', backgroundColor: 'var(--success-bg)', color: 'var(--success-strong)' }}
          >
            Request submitted. An admin will review.
          </div>
        ) : !requestOpen ? (
          <button
            type="button"
            onClick={() => setRequestOpen(true)}
            className="text-sm hover:underline"
            style={{ color: 'var(--accent)' }}
          >
            + Request new sanctioned club
          </button>
        ) : (
          <section
            className="p-4 rounded-lg border space-y-3"
            style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
          >
            <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
              Request a new sanctioned club
            </h2>
            <p className="text-xs" style={{ color: COLORS.muted }}>
              Don&apos;t see the sanctioning body you need? Submit a request and an
              admin will review.
            </p>
            <input
              type="text"
              autoFocus
              placeholder="Association name (e.g. International Buckskin Horse Assoc.)"
              value={requestName}
              onChange={(e) => setRequestName(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{ borderColor: COLORS.border }}
            />
            <textarea
              placeholder="Notes (optional) — link to association, context, etc."
              value={requestNotes}
              onChange={(e) => setRequestNotes(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{ borderColor: COLORS.border, minHeight: 60 }}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setRequestOpen(false);
                  setRequestName('');
                  setRequestNotes('');
                }}
                className="text-sm rounded px-3 py-2 border"
                style={{ borderColor: COLORS.border, color: COLORS.text, backgroundColor: 'var(--surface)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitRequest}
                disabled={busy || !requestName.trim()}
                title={requestName.trim() ? undefined : 'Enter the association name first'}
                className="text-sm rounded px-3 py-2 disabled:opacity-50"
                style={{ backgroundColor: COLORS.warn, color: 'var(--surface)' }}
              >
                Submit request
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * One club's class list. Controlled — it holds no draft of its own and has no
 * Save button, because the step saves as a whole. Day-grouped with a filter,
 * and select/clear scoped to what the filter is showing: somebody who typed
 * "Pleasure" to find the eleven pleasure classes means those eleven, and a
 * 172-class show is not worked one checkbox at a time.
 *
 * Two views, because ticking the list and checking the list are different jobs.
 * **All** is where the work is done; **Ticked** is the answer on its own — the
 * twenty-one classes this club approves, without scrolling a 172-row schedule
 * hunting for ticks. That review is what somebody does before leaving the step,
 * and against a paper show bill it is the only view that can be read straight
 * down. The text filter narrows whichever view is showing, so "Ticked" plus
 * "Pleasure" answers "which pleasure classes did I give this club?".
 */
/**
 * One half of the All / Ticked pair. Filled when it is the view being shown,
 * because two outlined buttons side by side say which one you may press and
 * not which one you are looking at.
 */
function ViewButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className="text-xs px-2 py-1"
      style={{
        backgroundColor: active ? COLORS.warn : COLORS.bg,
        color: active ? 'var(--surface)' : COLORS.warn,
      }}
    >
      {children}
    </button>
  );
}

function ClubClassPicker({
  code,
  name,
  feeCents,
  unit,
  judgeCount,
  classes,
  selected,
  onChange,
}: {
  code: string;
  name: string;
  feeCents: number;
  unit: ClubSanctionUnit;
  judgeCount: number;
  classes: SanctionedClass[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [filter, setFilter] = useState('');
  const [view, setView] = useState<'all' | 'selected'>('all');

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    // Both narrowings compose, and the ticked one reads off `selected` rather
    // than a frozen copy: unticking a class in the Ticked view drops it out of
    // the list on the spot, which is what taking it off the club's list means.
    // A snapshot would leave a row behind that says it is not approved, which
    // is the same list disagreeing with itself.
    return classes.filter(
      (c) =>
        (view === 'all' || selected.has(c.id)) &&
        (!q ||
          c.class_name.toLowerCase().includes(q) ||
          c.class_number.toLowerCase().includes(q)),
    );
  }, [classes, filter, view, selected]);

  const byDay = useMemo(() => {
    const map = new Map<string, SanctionedClass[]>();
    for (const c of filtered) {
      const list = map.get(c.class_date) ?? [];
      list.push(c);
      map.set(c.class_date, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  function setAllVisible(on: boolean) {
    const next = new Set(selected);
    for (const c of filtered) {
      if (on) next.add(c.id);
      else next.delete(c.id);
    }
    onChange(next);
  }

  const visibleSelected = filtered.filter((c) => selected.has(c.id)).length;
  const searching = filter.trim().length > 0;
  // What the bulk buttons would act on, said in words. "all" is only honest
  // when nothing is narrowing the list — with either filter on it is a subset,
  // and a button reading "Clear all" that clears eleven of a hundred and
  // seventy-two is the one press nobody can undo.
  const visibleDescription = searching
    ? `the ${filtered.length} class${filtered.length === 1 ? '' : 'es'} matching "${filter.trim()}"${
        view === 'selected' ? ' that are ticked' : ''
      }`
    : view === 'selected'
      ? `the ${filtered.length} class${filtered.length === 1 ? '' : 'es'} ticked for this club`
      : 'every class in the show';

  return (
    <section
      className="rounded-lg border"
      style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
    >
      <div className="p-4 space-y-2 border-b" style={{ borderColor: COLORS.borderSoft }}>
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
            Classes {name}{' '}
            <span className="font-mono text-xs" style={{ color: 'var(--accent)' }}>
              {code}
            </span>{' '}
            approves
          </h2>
          <span className="text-sm" style={{ color: COLORS.muted }}>
            {selected.size} of {classes.length} classes
            {feeCents > 0 &&
              (unit === 'per_entry' ? (
                <>
                  {' '}· {formatMoney(feeCents)} per class ={' '}
                  <strong style={{ color: COLORS.text }}>
                    {formatMoney(feeCents * selected.size)}
                  </strong>{' '}
                  on an entry in every one
                </>
              ) : (
                /* Nothing to multiply the ticked classes by: these units count
                   horses or exhibitors across whichever of them somebody
                   entered, which is not known until they do. */
                <>
                  {' '}·{' '}
                  <strong style={{ color: COLORS.text }}>
                    {formatMoney(
                      usesJudgeCount(unit) ? feeCents * judgeCount : feeCents,
                    )}
                  </strong>{' '}
                  {unitLabel(unit)}
                  {usesJudgeCount(unit) && judgeCount > 0
                    ? ` (${formatMoney(feeCents)} × ${judgeCount})`
                    : ''}
                  , to anyone who enters one of them
                </>
              ))}
          </span>
        </div>
      </div>

      <div
        className="px-4 py-2 flex items-center gap-2 flex-wrap border-b"
        style={{ borderColor: COLORS.borderSoft }}
      >
        {/* Which classes the list is showing. First in the row because it is
            the lens everything after it works through — the text filter
            narrows this view, and the bulk buttons act on what it leaves. */}
        <div className="flex rounded border overflow-hidden" style={{ borderColor: COLORS.border }}>
          <ViewButton
            active={view === 'all'}
            onClick={() => setView('all')}
            title="Show every class in the show"
          >
            All ({classes.length})
          </ViewButton>
          <ViewButton
            active={view === 'selected'}
            onClick={() => setView('selected')}
            title={
              selected.size === 0
                ? 'Nothing is ticked for this club yet'
                : `Show only the ${selected.size} class${
                    selected.size === 1 ? '' : 'es'
                  } ticked for this club`
            }
          >
            Ticked ({selected.size})
          </ViewButton>
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by number or name"
          className="text-sm border rounded px-2 py-1"
          style={{ borderColor: COLORS.border }}
        />
        <button
          type="button"
          onClick={() => setAllVisible(true)}
          /* Every row in the Ticked view is ticked already, so there is
             nothing for this to do. Disabled with a reason rather than
             hidden: a control that vanishes reads as a bug in a toolbar
             somebody was just using. */
          disabled={view === 'selected'}
          className="text-xs rounded px-2 py-1 border disabled:opacity-50"
          style={{ borderColor: COLORS.border, color: COLORS.warn }}
          title={
            view === 'selected'
              ? 'Every class in this view is already ticked — switch to All to add more'
              : `Tick ${visibleDescription}`
          }
        >
          Select {searching ? `matching (${filtered.length})` : 'all'}
        </button>
        <button
          type="button"
          onClick={() => setAllVisible(false)}
          className="text-xs rounded px-2 py-1 border"
          style={{ borderColor: COLORS.border, color: COLORS.warn }}
          title={`Untick ${visibleDescription}`}
        >
          Clear{' '}
          {searching
            ? `matching (${visibleSelected})`
            : view === 'selected'
              ? `these (${visibleSelected})`
              : 'all'}
        </button>
      </div>

      <div className="overflow-y-auto" style={{ maxHeight: '360px' }}>
        {byDay.length === 0 ? (
          <p className="p-3 text-sm" style={{ color: COLORS.muted }}>
            {/* An empty Ticked view is not a failed search — it is the honest
                answer to "what has this club got so far?", and saying "no
                matching classes" over it reads as the filter being broken. */}
            {view === 'selected' && !searching
              ? `No classes are ticked for ${code} yet — switch to All and tick the ones it approves.`
              : view === 'selected'
                ? 'None of the ticked classes match that filter.'
                : 'No matching classes.'}
          </p>
        ) : (
          byDay.map(([day, dayClasses]) => (
            <div key={day}>
              <div
                className="px-3 py-1.5 text-xs font-medium sticky top-0"
                style={{ backgroundColor: 'var(--background)', color: 'var(--text-deep)' }}
              >
                {formatDay(day)}
              </div>
              {dayClasses.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm border-t cursor-pointer hover:bg-amber-50"
                  style={{ borderColor: COLORS.borderSoft }}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                  />
                  <span
                    className="text-xs font-mono px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--accent)' }}
                  >
                    #{c.class_number}
                  </span>
                  <span style={{ color: COLORS.text }}>{c.class_name}</span>
                  <span className="ml-auto text-xs" style={{ color: COLORS.muted }}>
                    {c.entry_fee_cents > 0 ? formatMoney(c.entry_fee_cents) : '—'}
                  </span>
                </label>
              ))}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
