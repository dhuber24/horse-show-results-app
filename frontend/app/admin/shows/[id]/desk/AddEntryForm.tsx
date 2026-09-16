'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  EMPTY_CHOICE,
  EnrollmentFields,
  choiceIsComplete,
  enrollHorse,
  type EnrollmentChoice,
} from './FuturityEnrollment';
import { COLORS, futurityEnrollment, futurityForClass } from './types';
import type { Desk, DeskClass, DeskExhibitor, ProfileHorse } from './types';
import { formatMoney } from '@/lib/financials';
import {
  ATTESTATION_REQUIRED_DIVISIONS,
  NOVICE_ELIGIBILITY_STATEMENT,
  divisionLabel,
} from '@/lib/apha';

/**
 * Adding one class entry, from either end.
 *
 * The desk asks this question two ways — "what else is this person riding?" on
 * their panel, and "who else is in this class?" from the by-class view — and
 * they are the same form with one side pinned. Writing it twice would have
 * meant two copies of the Novice declaration and the horse lookup, which is
 * exactly the kind of pair that drifts.
 *
 * Pin the exhibitor by passing `exhibitor`, or the class by passing `cls`. The
 * other side gets a picker.
 *
 * **No division picker and no relationship picker**, the same as the
 * exhibitor's own form. The division was chosen when the class was built — its
 * bracket says Amateur or Youth 14-18 — so the class is the answer and the
 * screen states it. How the exhibitor is related to the horse's owner is
 * derived from ownership or read off their horse link, which is where the
 * profile keeps it. `POST .../entries` fills both from those same sources, so
 * sending nothing here stores exactly what a picker with one right answer
 * would have.
 *
 * **A futurity class asks for the futurity enrollment in the same press.** The
 * class carries no fee of its own — the enrollment's category is its price — so
 * entering the class without enrolling the horse billed nothing and left the
 * desk's total short with nothing on screen to say why.
 */

function backendMessage(detail: unknown, fallback: string): string {
  if (typeof detail === 'string') return detail;
  const d = detail as { code?: string; message?: string; issues?: { severity: string; message: string }[] };
  if (d?.code === 'ASSOCIATION_VALIDATION_FAILED' && Array.isArray(d.issues)) {
    return d.issues.filter((i) => i.severity === 'error').map((i) => i.message).join(' ');
  }
  return d?.message ?? fallback;
}

export default function AddEntryForm({
  showId,
  desk,
  exhibitor,
  cls,
  onAdded,
}: {
  showId: string;
  desk: Desk;
  /** Pin the exhibitor and pick the class. */
  exhibitor?: DeskExhibitor;
  /** Pin the class and pick the exhibitor. */
  cls?: DeskClass;
  onAdded: () => Promise<void>;
}) {
  const [pickedClassId, setPickedClassId] = useState('');
  const [pickedExhibitorId, setPickedExhibitorId] = useState('');
  const [horseId, setHorseId] = useState('');
  const [noviceDeclared, setNoviceDeclared] = useState(false);
  const [horses, setHorses] = useState<ProfileHorse[]>([]);
  const [horsesLoading, setHorsesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enroll, setEnroll] = useState(true);
  const [enrollment, setEnrollment] = useState<EnrollmentChoice>(EMPTY_CHOICE);

  const isApha = desk.show_type_code === 'APHA';
  const exhibitorId = exhibitor?.exhibitor_id ?? pickedExhibitorId;
  const classId = cls?.id ?? pickedClassId;
  const activeClass = cls ?? desk.classes.find((c) => c.id === pickedClassId);
  const person = exhibitor ?? desk.exhibitors.find((e) => e.exhibitor_id === pickedExhibitorId);

  // The futurity that prices this class, when the horse is not in it yet.
  const futurity = classId ? futurityForClass(desk, classId) : undefined;
  const existingEnrollment = futurity ? futurityEnrollment(person, futurity.id, horseId) : undefined;
  const offerEnrollment = Boolean(futurity && horseId && !existingEnrollment);
  const enrolling = offerEnrollment && enroll;
  const enrollmentIncomplete = enrolling && futurity !== undefined && !choiceIsComplete(futurity, enrollment);

  // Who and what is already in the class being filled — a horse can only be in
  // a class once (`entries_class_horse_uniq`), and only pattern classes let one
  // exhibitor ride several. Filtering here is the friendly half of rules the
  // backend enforces anyway.
  const takenInClass = useMemo(() => {
    const exhibitors = new Set<string>();
    const horseIds = new Set<string>();
    if (!classId) return { exhibitors, horseIds };
    for (const person of desk.exhibitors) {
      for (const entry of person.entries) {
        if (entry.class_id !== classId) continue;
        exhibitors.add(person.exhibitor_id);
        if (entry.horse_id) horseIds.add(entry.horse_id);
      }
    }
    return { exhibitors, horseIds };
  }, [desk.exhibitors, classId]);

  // What is still worth offering this exhibitor. Being entered finishes a
  // class for them — except a pattern class, the one kind they may ride twice
  // on different horses, and even that only holds while they still have a
  // horse that is not already in it. Offering a class whose horse picker will
  // then read "All their horses are already in" is the full list wearing a
  // filter. An unloaded horse list means offer it: hiding a class the desk
  // could legitimately enter is the worse failure of the two.
  const selectableClasses = useMemo(() => {
    if (cls) return [];
    const entries = exhibitor?.entries ?? [];
    return desk.classes.filter((c) => {
      if (c.status === 'CLOSED') return false;
      const entered = entries.filter((e) => e.class_id === c.id);
      if (entered.length === 0) return true;
      if (c.score_type !== 'pattern') return false;
      if (horses.length === 0) return true;
      const takenHorseIds = new Set(entered.map((e) => e.horse_id));
      return horses.some((h) => !takenHorseIds.has(h.id));
    });
  }, [cls, desk.classes, exhibitor, horses]);

  const selectableExhibitors = useMemo(() => {
    if (exhibitor) return [];
    const allowRepeat = activeClass?.score_type === 'pattern';
    return desk.exhibitors.filter((e) => allowRepeat || !takenInClass.exhibitors.has(e.exhibitor_id));
  }, [exhibitor, desk.exhibitors, activeClass, takenInClass]);

  useEffect(() => {
    setHorseId('');
    if (!exhibitorId) {
      setHorses([]);
      return;
    }
    let cancelled = false;
    setHorsesLoading(true);
    fetch(`/api/exhibitors/${exhibitorId}/my-horses`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (!cancelled) setHorses(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setHorses([]);
      })
      .finally(() => {
        if (!cancelled) setHorsesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [exhibitorId]);

  const selectableHorses = useMemo(
    () => horses.filter((h) => !takenInClass.horseIds.has(h.id)),
    [horses, takenInClass],
  );

  // Off the class, never off a picker — the same `division_for_class` answer
  // the entry endpoint files. Empty means the class does not say, and the entry
  // goes in with no division.
  const aphaDivision = (isApha && activeClass?.apha_division) || '';

  // The Novice divisions turn on points and earnings the app does not hold, so
  // the entry carries a declaration instead of a check. The backend enforces it;
  // blocking here keeps the desk from posting an entry it knows will 422.
  const needsNoviceDeclaration = isApha && ATTESTATION_REQUIRED_DIVISIONS.has(aphaDivision);
  const missingNoviceDeclaration = needsNoviceDeclaration && !noviceDeclared;

  const submit = async () => {
    if (!classId || !exhibitorId || !horseId) {
      setError('Pick a class, an exhibitor, and a horse.');
      return;
    }
    setSaving(true);
    setError(null);

    const body: Record<string, unknown> = {
      showId,
      classId,
      exhibitor_id: exhibitorId,
      horse_id: horseId,
      is_disqualified: false,
    };
    // Neither the division nor the relationship to the owner is sent: the
    // endpoint fills both from the class and the horse link.
    if (needsNoviceDeclaration && noviceDeclared) body.attestations = ['novice_eligibility'];

    const res = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      setSaving(false);
      const payload = await res.json().catch(() => ({}));
      setError(backendMessage(payload?.detail ?? payload?.error, 'Could not add that entry.'));
      return;
    }

    // The class entry stands whatever happens next. A failed enrollment is
    // reported against it rather than rolled back, and the panel goes on
    // offering the enrollment until it is made.
    let enrollmentProblem: string | null = null;
    if (enrolling && futurity && person) {
      enrollmentProblem = await enrollHorse({
        showId,
        futurity,
        exhibitor: person,
        horseId,
        choice: enrollment,
      });
    }
    setSaving(false);

    // Clear only the side that was being chosen; the pinned side is still the
    // job in hand — six classes on one horse, or a queue of riders for class 14.
    if (exhibitor) setPickedClassId('');
    else {
      setPickedExhibitorId('');
      setHorseId('');
    }
    setEnrollment(EMPTY_CHOICE);
    setEnroll(true);
    if (enrollmentProblem) {
      setError(`Entered in the class, but the futurity enrollment did not save: ${enrollmentProblem}`);
    }
    await onAdded();
  };

  const horsePlaceholder = !exhibitorId
    ? 'Pick an exhibitor first'
    : horsesLoading
      ? 'Loading horses…'
      : horses.length === 0
        ? 'No horses on file'
        : selectableHorses.length === 0
          ? 'All their horses are already in'
          : 'On which horse…';

  return (
    <div className="rounded border p-3 space-y-2" style={{ borderColor: COLORS.borderSoft, backgroundColor: 'var(--surface)' }}>
      <div className="flex flex-wrap gap-2">
        {exhibitor ? (
          <select
            value={pickedClassId}
            onChange={(e) => setPickedClassId(e.target.value)}
            aria-label="Class"
            className="flex-1 min-w-[220px] border rounded px-3 py-2 text-sm"
            style={{ borderColor: COLORS.border }}
          >
            <option value="">
              {selectableClasses.length === 0 ? 'No classes left to enter' : 'Add a class…'}
            </option>
            {selectableClasses.map((c) => {
              // The only rows left that they are already in are pattern
              // classes with a horse to spare. Say so, or the entry reads as
              // the filter having missed one.
              const ridingAlready = (exhibitor?.entries ?? []).some((e) => e.class_id === c.id);
              return (
                <option key={c.id} value={c.id}>
                  {c.class_number} — {c.class_name}
                  {futurityForClass(desk, c.id)
                    ? ' (priced by the futurity)'
                    : c.entry_fee_cents > 0
                      ? ` (${formatMoney(c.entry_fee_cents)})`
                      : ''}
                  {ridingAlready ? ' · another horse' : ''}
                </option>
              );
            })}
          </select>
        ) : (
          <select
            value={pickedExhibitorId}
            onChange={(e) => setPickedExhibitorId(e.target.value)}
            aria-label="Exhibitor"
            className="flex-1 min-w-[220px] border rounded px-3 py-2 text-sm"
            style={{ borderColor: COLORS.border }}
          >
            <option value="">
              {selectableExhibitors.length === 0
                ? 'Everyone on the roster is already in'
                : 'Add an exhibitor…'}
            </option>
            {selectableExhibitors.map((e) => (
              <option key={e.exhibitor_id} value={e.exhibitor_id}>
                {e.back_number != null ? `#${e.back_number} ` : ''}
                {e.exhibitor_name}
              </option>
            ))}
          </select>
        )}

        <select
          value={horseId}
          onChange={(e) => setHorseId(e.target.value)}
          disabled={!exhibitorId || horsesLoading || selectableHorses.length === 0}
          aria-label="Horse"
          title={
            !exhibitorId
              ? 'Pick an exhibitor first'
              : !horsesLoading && horses.length === 0
                ? 'This exhibitor has no horses on file — add one from their desk panel'
                : undefined
          }
          className="flex-1 min-w-[180px] border rounded px-3 py-2 text-sm disabled:opacity-50"
          style={{ borderColor: COLORS.border }}
        >
          <option value="">{horsePlaceholder}</option>
          {selectableHorses.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </div>

      {/* Stated, not asked: it goes on the entry and is reported to APHA, so
          the desk should see what is being filed — but it follows from the
          class, and a control with one correct answer is not a question. */}
      {isApha && activeClass && aphaDivision && (
        <p
          className="text-xs"
          style={{ color: 'var(--text-deep)' }}
          title="Filed on the entry and reported to APHA. It follows from the class's bracket, set when the class was built."
        >
          Division: <strong>{divisionLabel(aphaDivision)}</strong>
          <span style={{ color: COLORS.muted }}> — from the class.</span>
        </p>
      )}

      {needsNoviceDeclaration && (
        <label className="flex items-start gap-2 text-xs rounded border p-2" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
          <input
            type="checkbox"
            checked={noviceDeclared}
            onChange={(e) => setNoviceDeclared(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span style={{ color: 'var(--text-deep)' }}>{NOVICE_ELIGIBILITY_STATEMENT}</span>
        </label>
      )}

      {futurity && horseId && existingEnrollment && (
        <p className="text-xs" style={{ color: COLORS.muted }}>
          Priced by {futurity.name}:{' '}
          {existingEnrollment.fee_tier_name ?? 'enrolled'}
          {existingEnrollment.tier_amount_cents > 0 &&
            ` — ${formatMoney(existingEnrollment.tier_amount_cents)} per class`}
          .
        </p>
      )}

      {offerEnrollment && futurity && (
        <div
          className="rounded border p-2 space-y-2"
          style={{ borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)' }}
        >
          <label className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-deep)' }}>
            <input
              type="checkbox"
              checked={enroll}
              onChange={(e) => setEnroll(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <span>
              Enroll this horse in <strong>{futurity.name}</strong> too. This class has no fee of
              its own — the futurity category prices it, so without the enrollment nothing is
              billed for it.
            </span>
          </label>
          {enroll && (
            <EnrollmentFields
              futurity={futurity}
              value={enrollment}
              onChange={setEnrollment}
              idPrefix={`add-entry-${futurity.id}`}
            />
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={
          !classId ||
          !exhibitorId ||
          !horseId ||
          missingNoviceDeclaration ||
          enrollmentIncomplete ||
          saving
        }
        title={
          !classId || !exhibitorId || !horseId
            ? 'Pick an exhibitor and a horse first'
            : missingNoviceDeclaration
              ? 'Novice entries need the eligibility declaration ticked'
              : enrollmentIncomplete
                ? 'Pick the futurity category, or untick the enrollment'
                : undefined
        }
        className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
        style={{ backgroundColor: COLORS.dark, color: COLORS.onDark }}
      >
        {saving ? 'Adding…' : enrolling ? 'Enter class & enroll' : 'Enter class'}
      </button>
    </div>
  );
}
