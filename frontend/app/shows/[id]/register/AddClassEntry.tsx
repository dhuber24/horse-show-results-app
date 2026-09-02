'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ATTESTATION_REQUIRED_DIVISIONS,
  NOVICE_ELIGIBILITY_STATEMENT,
  RELATIONSHIP_REQUIRED_DIVISIONS,
  divisionLabel,
} from '@/lib/apha';
import {
  formatMoney,
  healthWarnings,
  type ExistingEntry,
  type PreviewClass,
  type PreviewHorse,
} from './types';

/**
 * Enter one class, then the next.
 *
 * This is the show office's own entry form with the exhibitor pinned — the same
 * shape as `admin/shows/[id]/desk/AddEntryForm`: pick what is left to enter,
 * pick the horse, press the button, done. It replaced a page-long list of every
 * class in the show with a horse select on each row and one Submit at the
 * bottom, which asked people to hold a whole registration in their head and
 * then reported a clash — a closed class, a horse already in — only once they
 * had filled the lot in and pressed the button.
 *
 * The dropdown carries the same filtering the desk applies, for the same
 * reason: a class you cannot enter is not worth offering, and a class you *can*
 * enter twice is. Pattern classes are judged run by run, so one exhibitor may
 * show two horses in them — and only while a horse is left that is not already
 * in it.
 *
 * It posts to the exhibitor's own endpoint, not the staff one. Same form, same
 * rules, different door: `POST /shows/{id}/register` derives the exhibitor from
 * the session, so this cannot be pointed at anybody else.
 *
 * **Two questions it no longer asks. Pick a class, pick a horse, press the
 * button — that is the whole form.**
 *
 * There was an APHA division picker offering all nine divisions on every class,
 * so a class the show had already named "56 - Youth WT Showmanship 5-10" could
 * be entered as Amateur. That is not a class the show runs, and nothing
 * downstream would have caught it: `apha_division` is stored data and every
 * rule that reads it takes the entry at its word. It is gone entirely, because
 * **the class already answers it** — `divisions_for_bracket` reads the division
 * off the bracket, which is the column that exists for exactly that, and every
 * bracket it matches resolves to one division. A class whose bracket says
 * nothing is filed with no division, which is what every entry did before the
 * picker existed and what `validate_entry` handles by design.
 *
 * The relationship to the horse's owner is answered once, per horse, on the
 * wizard's horses step — and usually not even there, since somebody showing
 * their own horse is "Self" and the horse's record already says so. Asking it
 * per class from a list of twenty-five meant entering eight classes on one
 * horse produced the same answer eight times, or a different one on the eighth.
 */

function backendMessage(detail: unknown, fallback: string): string {
  if (typeof detail === 'string') return detail;
  const d = detail as {
    code?: string;
    message?: string;
    issues?: { severity: string; message: string }[];
  };
  if (d?.code === 'ASSOCIATION_VALIDATION_FAILED' && Array.isArray(d.issues)) {
    return d.issues.filter((i) => i.severity === 'error').map((i) => i.message).join(' ');
  }
  return d?.message ?? fallback;
}

function formatDay(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export default function AddClassEntry({
  showId,
  showTypeCode,
  classes,
  horses,
  existingEntries,
  onAdded,
}: {
  showId: string;
  showTypeCode: string | null;
  classes: PreviewClass[];
  horses: PreviewHorse[];
  existingEntries: ExistingEntry[];
  /** Re-reads the preview so the entered list, the bill, and this form's own
   *  remaining-classes list all move together. */
  onAdded: () => void;
}) {
  const [classId, setClassId] = useState('');
  const [horseId, setHorseId] = useState('');
  const [noviceDeclared, setNoviceDeclared] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isApha = showTypeCode === 'APHA';

  const horseIdsByClass = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const e of existingEntries) {
      const list = map.get(e.class_id) ?? [];
      if (e.horse_id) list.push(e.horse_id);
      map.set(e.class_id, list);
    }
    return map;
  }, [existingEntries]);

  // Being entered finishes a class — except a pattern class, and even that only
  // while a horse is left to put in it. Mirrors `selectableClasses` on the desk
  // form; the backend 409s on the rest either way.
  const selectableClasses = useMemo(
    () =>
      classes.filter((c) => {
        const taken = horseIdsByClass.get(c.id);
        if (!taken || taken.length === 0) return true;
        if (c.score_type !== 'pattern') return false;
        return horses.some((h) => !taken.includes(h.id));
      }),
    [classes, horseIdsByClass, horses],
  );

  const activeClass = selectableClasses.find((c) => c.id === classId);

  // One horse cannot run the same class twice (`entries_class_horse_uniq`).
  const selectableHorses = useMemo(() => {
    const taken = horseIdsByClass.get(classId) ?? [];
    return horses.filter((h) => !taken.includes(h.id));
  }, [horses, horseIdsByClass, classId]);

  // Grouped by day, which the desk's form does not do — staff are handed a
  // class number, an exhibitor is reading a schedule and picking a Saturday.
  const classesByDay = useMemo(() => {
    const grouped = new Map<string, PreviewClass[]>();
    for (const c of selectableClasses) {
      const list = grouped.get(c.class_date) ?? [];
      list.push(c);
      grouped.set(c.class_date, list);
    }
    return Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [selectableClasses]);

  // The division comes off the class, never off a picker. `apha_divisions` is
  // what `divisions_for_bracket` read out of the class's bracket, and every
  // bracket it matches resolves to one — so there is nothing to choose. Empty
  // means the class does not say, and the entry is filed without a division,
  // exactly as every entry was before the picker existed.
  const aphaDivision = (isApha && activeClass?.apha_divisions?.[0]) || '';

  const selectedHorse = horses.find((h) => h.id === horseId);
  const spbBlocked = isApha && aphaDivision === 'OPEN' && selectedHorse?.is_solid_paint_bred === true;

  const needsRelationship = isApha && RELATIONSHIP_REQUIRED_DIVISIONS.has(aphaDivision);
  // Answered on the horses step. Missing is a prompt with a destination, never
  // a block: the backend takes the entry either way and the office chases it,
  // the same way it chases a membership card.
  const missingRelationship = needsRelationship && !selectedHorse?.relationship_to_owner;
  // Novice eligibility is the exhibitor’s own declaration to make (AM-205), and
  // this is the door where they are the one making it.
  const needsNoviceDeclaration = isApha && ATTESTATION_REQUIRED_DIVISIONS.has(aphaDivision);
  const missingNoviceDeclaration = needsNoviceDeclaration && !noviceDeclared;

  const submit = async () => {
    if (!classId || !horseId) {
      setError('Pick a class and a horse.');
      return;
    }
    setSaving(true);
    setError(null);

    const entry: Record<string, unknown> = { class_id: classId, horse_id: horseId };
    if (isApha && aphaDivision) entry.apha_division = aphaDivision;
    // `relationship_to_owner` is deliberately not sent. The backend reads it
    // off `exhibitor_horses`, which is where the horses step wrote it.
    if (needsNoviceDeclaration && noviceDeclared) entry.attestations = ['novice_eligibility'];

    try {
      const res = await fetch(`/api/shows/${showId}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: [entry] }),
      });
      setSaving(false);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(backendMessage(payload?.detail ?? payload?.error, 'Could not enter that class.'));
        return;
      }
      // The horse carries over — somebody entering six classes is usually
      // entering them on the same horse — so only the class is cleared.
      setClassId('');
      onAdded();
    } catch {
      setSaving(false);
      setError('Network error — please try again.');
    }
  };

  // Nothing left to put in the picked class. Reachable on a pattern class,
  // which stays on offer while a horse is spare and stops the moment the last
  // one goes in: the box says why rather than sitting empty and enabled.
  const allHorsesEntered = Boolean(classId) && selectableHorses.length === 0;
  const horsePlaceholder = !classId
    ? 'Pick a class first'
    : allHorsesEntered
      ? 'All your available horses are entered in the class already'
      : 'On which horse…';

  const nothingLeft = selectableClasses.length === 0;
  // Classes dropped from the picker because this exhibitor is done with them.
  // Worth saying out loud: somebody looking for a class they entered an hour
  // ago should not be left wondering whether the show pulled it.
  const enteredCount = classes.length - selectableClasses.length;

  return (
    <div
      className="rounded border p-3 space-y-2"
      style={{ borderColor: '#e8d5b7', backgroundColor: '#fffdf9' }}
    >
      <div className="flex flex-wrap gap-2">
        <select
          value={classId}
          onChange={(e) => {
            setClassId(e.target.value);
            setError(null);
          }}
          disabled={nothingLeft}
          aria-label="Class"
          title={nothingLeft ? 'You are already entered in every class at this show' : undefined}
          className="flex-1 min-w-[220px] border rounded px-3 py-2 text-sm disabled:opacity-50"
          style={{ borderColor: '#d4b896' }}
        >
          <option value="">{nothingLeft ? 'No classes left to enter' : 'Add a class…'}</option>
          {classesByDay.map(([day, dayClasses]) => (
            <optgroup key={day} label={formatDay(day)}>
              {dayClasses.map((c) => {
                // The only rows left that they are already in are pattern
                // classes with a horse to spare. Say so, or the entry reads as
                // the filter having missed one.
                const ridingAlready = (horseIdsByClass.get(c.id) ?? []).length > 0;
                return (
                  <option key={c.id} value={c.id}>
                    {c.class_number} — {c.class_name}
                    {c.entry_fee_cents > 0 ? ` (${formatMoney(c.entry_fee_cents)})` : ''}
                    {c.sanctioning_codes.length > 0 ? ` · ${c.sanctioning_codes.join(', ')}` : ''}
                    {ridingAlready ? ' · another horse' : ''}
                  </option>
                );
              })}
            </optgroup>
          ))}
        </select>

        <select
          value={horseId}
          onChange={(e) => setHorseId(e.target.value)}
          disabled={!classId || allHorsesEntered}
          aria-label="Horse"
          title={
            allHorsesEntered
              ? 'All your available horses are entered in the class already'
              : !classId
                ? 'Pick a class first'
                : undefined
          }
          className="flex-1 min-w-[180px] border rounded px-3 py-2 text-sm disabled:opacity-50"
          style={{ borderColor: '#d4b896' }}
        >
          <option value="">{horsePlaceholder}</option>
          {selectableHorses.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
              {h.is_solid_paint_bred ? ' (SPB)' : ''}
              {/* Marked, never enforced — the panel above says what is due. */}
              {healthWarnings(h).length > 0 ? ' ⚠ records due' : ''}
            </option>
          ))}
        </select>
      </div>

      {enteredCount > 0 && !nothingLeft && (
        <p className="text-xs" style={{ color: '#8b7355' }}>
          {enteredCount === 1 ? '1 class is' : `${enteredCount} classes are`} off this list
          because you are already in {enteredCount === 1 ? 'it' : 'them'} — they are listed
          above.
        </p>
      )}

      {/* Stated, not asked. It goes on the entry and is reported to APHA, so
          the exhibitor should be able to see what is being filed for them —
          but it follows from the class they just picked, and a control with
          one correct answer is not a question. */}
      {isApha && activeClass && aphaDivision && (
        <p className="text-xs" style={{ color: '#5d4a37' }}>
          Division: <strong>{divisionLabel(aphaDivision)}</strong>
          <span style={{ color: '#8b7355' }}>
            {' '}— from this class&apos;s bracket.
          </span>
        </p>
      )}

      {/* A prompt with a destination, never a block — the entry goes in either
          way and the office chases it, the same as a membership card. */}
      {missingRelationship && selectedHorse && (
        <p
          className="text-xs rounded border p-2"
          style={{ backgroundColor: '#fffbeb', borderColor: '#fde68a', color: '#92400e' }}
        >
          APHA asks how you are related to {selectedHorse.name}&apos;s owner on{' '}
          {divisionLabel(aphaDivision)} entries (AM-300.E, YP-015). Set it once on{' '}
          <Link href="#registration-horses" className="font-medium underline" style={{ color: '#8b4513' }}>
            your horses
          </Link>{' '}
          and it carries onto every class.
        </p>
      )}

      {needsNoviceDeclaration && (
        <label className="flex items-start gap-2 text-xs rounded border p-2" style={{ borderColor: '#d4b896', backgroundColor: '#fffdf7' }}>
          <input
            type="checkbox"
            checked={noviceDeclared}
            onChange={(e) => setNoviceDeclared(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span style={{ color: '#5a3e2b' }}>{NOVICE_ELIGIBILITY_STATEMENT}</span>
        </label>
      )}

      {spbBlocked && (
        <p
          className="text-sm rounded border p-2"
          style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca', color: '#b91c1c' }}
        >
          Solid Paint-Bred horses may not enter Open division classes (APHA SC-325.A.1).
        </p>
      )}

      {error && <p className="text-sm" style={{ color: '#b91c1c' }}>{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={!classId || !horseId || spbBlocked || missingNoviceDeclaration || saving}
          title={
            spbBlocked
              ? 'Solid Paint-Bred horses may not enter Open division classes'
              : !classId || !horseId
                ? 'Pick a class and a horse first'
                : missingNoviceDeclaration
                  ? 'Tick the eligibility declaration to enter a Novice class'
                  : undefined
          }
          className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: '#8b4513' }}
        >
          {saving ? 'Entering…' : 'Enter class'}
        </button>
        {activeClass && horseId && !spbBlocked && (
          <span className="text-xs" style={{ color: '#8b7355' }}>
            {activeClass.entry_fee_cents > 0
              ? `${formatMoney(
                  activeClass.entry_fee_cents + activeClass.sanction_cents,
                )} added to your bill`
              : 'No entry fee'}
          </span>
        )}
      </div>
    </div>
  );
}
