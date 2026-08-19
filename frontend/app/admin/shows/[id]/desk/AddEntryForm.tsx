'use client';

import { useEffect, useMemo, useState } from 'react';
import { COLORS } from './types';
import type { Desk, DeskClass, DeskExhibitor, ProfileHorse } from './types';
import { formatMoney } from '@/lib/financials';
import { APHA_DIVISIONS, RELATIONSHIP_OPTIONS, RELATIONSHIP_REQUIRED_DIVISIONS } from '@/lib/apha';

/**
 * Adding one class entry, from either end.
 *
 * The desk asks this question two ways — "what else is this person riding?" on
 * their panel, and "who else is in this class?" from the by-class view — and
 * they are the same form with one side pinned. Writing it twice would have
 * meant two copies of the SPB guard, the relationship-required rule, and the
 * horse lookup, which is exactly the kind of pair that drifts.
 *
 * Pin the exhibitor by passing `exhibitor`, or the class by passing `cls`. The
 * other side gets a picker.
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
  const [aphaDivision, setAphaDivision] = useState('');
  const [relationship, setRelationship] = useState('');
  const [horses, setHorses] = useState<ProfileHorse[]>([]);
  const [horsesLoading, setHorsesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isApha = desk.show_type_code === 'APHA';
  const exhibitorId = exhibitor?.exhibitor_id ?? pickedExhibitorId;
  const classId = cls?.id ?? pickedClassId;
  const activeClass = cls ?? desk.classes.find((c) => c.id === pickedClassId);

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

  const selectedHorse = horses.find((h) => h.id === horseId);
  const spbBlocked = isApha && aphaDivision === 'OPEN' && selectedHorse?.is_solid_paint_bred === true;
  const needsRelationship = isApha && RELATIONSHIP_REQUIRED_DIVISIONS.has(aphaDivision);

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
    if (isApha && aphaDivision) body.apha_division = aphaDivision;
    if (isApha && relationship) body.relationship_to_owner = relationship;

    const res = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setError(backendMessage(payload?.detail ?? payload?.error, 'Could not add that entry.'));
      return;
    }

    // Clear only the side that was being chosen; the pinned side is still the
    // job in hand — six classes on one horse, or a queue of riders for class 14.
    if (exhibitor) setPickedClassId('');
    else {
      setPickedExhibitorId('');
      setHorseId('');
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
    <div className="rounded border p-3 space-y-2" style={{ borderColor: COLORS.borderSoft, backgroundColor: '#fffdf9' }}>
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
                  {c.entry_fee_cents > 0 ? ` (${formatMoney(c.entry_fee_cents)})` : ''}
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
              {h.is_solid_paint_bred ? ' (SPB)' : ''}
            </option>
          ))}
        </select>
      </div>

      {isApha && (
        <div className="flex flex-wrap gap-2">
          <select
            value={aphaDivision}
            onChange={(e) => setAphaDivision(e.target.value)}
            aria-label="APHA division"
            className="flex-1 min-w-[160px] border rounded px-3 py-2 text-sm"
            style={{ borderColor: COLORS.border }}
          >
            <option value="">APHA division — not specified</option>
            {APHA_DIVISIONS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
          {needsRelationship && (
            <select
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              aria-label="Relationship to owner"
              className="flex-1 min-w-[160px] border rounded px-3 py-2 text-sm"
              style={{ borderColor: COLORS.border }}
            >
              <option value="">Relationship to owner…</option>
              {RELATIONSHIP_OPTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {spbBlocked && (
        <p className="text-sm rounded border border-red-300 bg-red-50 p-2 text-red-700">
          Solid Paint-Bred horses may not enter Open division classes (APHA SC-325.A.1).
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={!classId || !exhibitorId || !horseId || spbBlocked || saving}
        title={
          spbBlocked
            ? 'Solid Paint-Bred horses may not enter Open division classes'
            : !classId || !exhibitorId || !horseId
              ? 'Pick an exhibitor and a horse first'
              : undefined
        }
        className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
        style={{ backgroundColor: COLORS.dark, color: COLORS.onDark }}
      >
        {saving ? 'Adding…' : 'Enter class'}
      </button>
    </div>
  );
}
