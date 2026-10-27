'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  EMPTY_CHOICE,
  EnrollmentFields,
  choiceIsComplete,
  enrollHorse,
  type EnrollmentChoice,
} from './FuturityEnrollment';
import {
  COLORS,
  exhibitorNumbers,
  futurityEnrollment,
  futurityForClass,
  potsForClass,
  unmetPotsForClass,
} from './types';
import type { Desk, DeskClass, DeskExhibitor, DeskFuturity, DeskSidePot, ProfileHorse } from './types';
import { warningLines, type SavedEntry } from '@/lib/association-warnings';
import { formatMoney } from '@/lib/financials';
import {
  ATTESTATION_REQUIRED_DIVISIONS,
  NOVICE_ELIGIBILITY_STATEMENT,
  divisionLabel,
} from '@/lib/apha';

/**
 * Adding class entries, from either end.
 *
 * The desk asks this question two ways — "what is this horse showing in?" on an
 * exhibitor's panel, and "who else is in this class?" from the by-class view —
 * and they are the same form with one side pinned. Writing it twice would have
 * meant two copies of the Novice declaration, the side pot buy-in and the
 * futurity enrollment, which is exactly the kind of pair that drifts.
 *
 * Pin the exhibitor by passing `exhibitor`: pick the horse, then tick its
 * classes — **several in one press**, the way an entry blank is filled in. It
 * was one class per press, which made the desk pick the same horse for every
 * class of a six-class entry. Pin the class by passing `cls`: pick the exhibitor
 * and the horse, one entry.
 *
 * **No division picker and no relationship picker**, the same as the
 * exhibitor's own form. The division was chosen when the class was built — its
 * bracket says Amateur or Youth 14-18 — so the class is the answer and the
 * screen states it. How the exhibitor is related to the horse's owner is
 * derived from ownership or read off their horse link. `POST .../entries` fills
 * both from those same sources.
 *
 * **A futurity class asks for the futurity enrollment in the same press**, once
 * per futurity however many of its classes are ticked. The class carries no fee
 * of its own — the enrollment's category is its price — so entering the class
 * without enrolling the horse billed nothing and left the desk's total short.
 *
 * **A class in a side pot asks for the buy-in the same way, and this one is
 * required.** The pot bundles the class, so entering it is buying in — the
 * endpoint refuses the entry otherwise (`SIDE_POT_REQUIRED`) and takes the
 * buy-in in the same request so the two land together. One covering pot is
 * ticked for you; several are a choice.
 *
 * **Several classes go in one request each, in order, and stop at the first
 * refusal.** The desk's endpoint takes one class, and a refused class is
 * reported by name with the classes before it entered and the rest still
 * ticked — the same "the entry stands whatever happens next" rule the futurity
 * enrollment has always followed here. The exhibitor's own form commits a batch
 * all or nothing, because there nobody is standing at the counter to sort out
 * half of one.
 */

function backendMessage(detail: unknown, fallback: string): string {
  if (typeof detail === 'string') return detail;
  const d = detail as { code?: string; message?: string; issues?: { severity: string; message: string }[] };
  if (d?.code === 'ASSOCIATION_VALIDATION_FAILED' && Array.isArray(d.issues)) {
    return d.issues.filter((i) => i.severity === 'error').map((i) => i.message).join(' ');
  }
  return d?.message ?? fallback;
}

function plural(n: number, one: string, many = `${one}es`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function formatDay(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function unique<T extends { id: string }>(items: (T | undefined)[]): T[] {
  const byId = new Map<string, T>();
  for (const item of items) if (item) byId.set(item.id, item);
  return Array.from(byId.values());
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
  /** Pin the exhibitor: pick a horse and tick its classes. */
  exhibitor?: DeskExhibitor;
  /** Pin the class and pick the exhibitor. */
  cls?: DeskClass;
  onAdded: () => Promise<void>;
}) {
  const [pickedExhibitorId, setPickedExhibitorId] = useState('');
  const [horseId, setHorseId] = useState('');
  const [ticked, setTicked] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [noviceDeclared, setNoviceDeclared] = useState(false);
  const [horses, setHorses] = useState<ProfileHorse[]>([]);
  const [horsesLoading, setHorsesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  // Futurities the desk chose not to enroll the horse in, and the category
  // picked for each one it will.
  const [enrollOff, setEnrollOff] = useState<string[]>([]);
  const [enrollments, setEnrollments] = useState<Record<string, EnrollmentChoice>>({});
  // Which side pots these entries are buying into. Only ever pots that cover a
  // class being entered — the desk panel's own Side pots section is where
  // somebody joins a pot for its own sake.
  const [potIds, setPotIds] = useState<string[]>([]);

  const isApha = desk.show_type_code === 'APHA';
  const exhibitorId = exhibitor?.exhibitor_id ?? pickedExhibitorId;
  const person = exhibitor ?? desk.exhibitors.find((e) => e.exhibitor_id === pickedExhibitorId);
  const selectedHorse = horses.find((h) => h.id === horseId);

  useEffect(() => {
    setHorseId('');
    setTicked([]);
    if (!exhibitorId) {
      setHorses([]);
      return;
    }
    let cancelled = false;
    setHorsesLoading(true);
    fetch(`/api/exhibitors/${exhibitorId}/my-horses`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (cancelled) return;
        const list: ProfileHorse[] = Array.isArray(data) ? data : [];
        setHorses(list);
        // One horse is not a choice — on the exhibitor's panel, where the
        // horse comes first.
        if (exhibitor && list.length === 1) setHorseId(list[0].id);
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
    // `exhibitor` is read only to know which side is pinned, which never
    // changes for one mounted form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exhibitorId]);

  // ── The pinned class: who may still go in it ──────────────────────────────

  // Who and what is already in the pinned class — a horse can only be in a
  // class once (`entries_class_horse_uniq`), and only pattern classes let one
  // exhibitor ride several. Filtering here is the friendly half of rules the
  // backend enforces anyway.
  const takenInClass = useMemo(() => {
    const exhibitors = new Set<string>();
    const horseIds = new Set<string>();
    if (!cls) return { exhibitors, horseIds };
    for (const p of desk.exhibitors) {
      for (const entry of p.entries) {
        if (entry.class_id !== cls.id) continue;
        exhibitors.add(p.exhibitor_id);
        if (entry.horse_id) horseIds.add(entry.horse_id);
      }
    }
    return { exhibitors, horseIds };
  }, [desk.exhibitors, cls]);

  const selectableExhibitors = useMemo(() => {
    if (exhibitor) return [];
    const allowRepeat = cls?.score_type === 'pattern';
    return desk.exhibitors.filter((e) => allowRepeat || !takenInClass.exhibitors.has(e.exhibitor_id));
  }, [exhibitor, desk.exhibitors, cls, takenInClass]);

  const selectableHorses = useMemo(
    () => (cls ? horses.filter((h) => !takenInClass.horseIds.has(h.id)) : horses),
    [cls, horses, takenInClass],
  );

  // ── The pinned exhibitor: what this horse may still enter ─────────────────

  // Every class this horse is in, whoever is riding it: one horse cannot run
  // the same class twice.
  const horseClassIds = useMemo(() => {
    const ids = new Set<string>();
    if (!horseId) return ids;
    for (const p of desk.exhibitors) for (const e of p.entries) if (e.horse_id === horseId) ids.add(e.class_id);
    return ids;
  }, [desk.exhibitors, horseId]);

  // What is still worth offering. Being entered finishes a class for this
  // exhibitor — except a pattern class, the one kind they may ride twice on
  // different horses — and the horse's own entry finishes it outright.
  const offeredClasses = useMemo(() => {
    if (cls || !selectedHorse) return [];
    const entries = exhibitor?.entries ?? [];
    return desk.classes.filter((c) => {
      if (c.status === 'CLOSED' || horseClassIds.has(c.id)) return false;
      return c.score_type === 'pattern' || !entries.some((e) => e.class_id === c.id);
    });
  }, [cls, selectedHorse, exhibitor, desk.classes, horseClassIds]);

  const needle = filter.trim().toLowerCase();
  const shownByDay = useMemo(() => {
    const shown = needle
      ? offeredClasses.filter(
          (c) =>
            c.class_number.toLowerCase().startsWith(needle) ||
            c.class_name.toLowerCase().includes(needle) ||
            ticked.includes(c.id),
        )
      : offeredClasses;
    const grouped = new Map<string, DeskClass[]>();
    for (const c of shown) grouped.set(c.class_date, [...(grouped.get(c.class_date) ?? []), c]);
    return Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [offeredClasses, needle, ticked]);

  // ── What is being entered, from either end ────────────────────────────────

  const targetClasses: DeskClass[] = useMemo(
    () => (cls ? [cls] : offeredClasses.filter((c) => ticked.includes(c.id))),
    [cls, offeredClasses, ticked],
  );

  // The side pots these classes are bundled into, and whether each class's
  // buy-in is chosen. `coveringPots` is what the form lists (including a pot
  // they are already in, so the row explains why nothing is being asked for).
  const coveringPots: DeskSidePot[] = unique(targetClasses.flatMap((c) => potsForClass(desk, c.id)));
  const unmetByClass = targetClasses.map((c) => unmetPotsForClass(desk, person, c.id));
  const potRequired = unmetByClass.some((unmet) => unmet.length > 0);
  const missingPotChoice = unmetByClass.some(
    (unmet) => unmet.length > 0 && !unmet.some((pot) => potIds.includes(pot.id)),
  );

  // One pot to choose from is not a choice — tick it. Several is, and picking
  // for somebody would be picking which buy-in they pay. Choices already made
  // stay while a class being entered still needs the pot.
  const targetKey = `${targetClasses.map((c) => c.id).join(',')}|${person?.exhibitor_id ?? ''}`;
  useEffect(() => {
    setPotIds((prev) => {
      const needed = new Set(unmetByClass.flatMap((unmet) => unmet.map((pot) => pot.id)));
      const next = prev.filter((id) => needed.has(id));
      for (const unmet of unmetByClass) {
        if (unmet.length === 1 && !next.includes(unmet[0].id)) next.push(unmet[0].id);
      }
      return next;
    });
    // Keyed on what is being entered, by whom: `unmetByClass` is rebuilt on
    // every render and would re-run this forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  // The futurities that price these classes. One enrollment per futurity covers
  // every class in it, so a futurity is asked about once.
  const futurities: DeskFuturity[] = unique(targetClasses.map((c) => futurityForClass(desk, c.id)));
  const toEnroll = horseId ? futurities.filter((f) => !futurityEnrollment(person, f.id, horseId)) : [];
  const enrolledIn = horseId ? futurities.filter((f) => futurityEnrollment(person, f.id, horseId)) : [];
  const enrolling = toEnroll.filter((f) => !enrollOff.includes(f.id));
  const enrollmentIncomplete = enrolling.some((f) => !choiceIsComplete(f, enrollments[f.id] ?? EMPTY_CHOICE));

  // Off the class, never off a picker — the same `division_for_class` answer
  // the entry endpoint files. Empty means the class does not say.
  const divisionOf = (c: DeskClass) => (isApha && c.apha_division) || '';

  // The Novice divisions turn on points and earnings the app does not hold, so
  // the entry carries a declaration instead of a check. Offered, never
  // required: an association rule flags an entry rather than refusing it, so an
  // undeclared Novice entry goes in and comes back flagged for the office.
  const needsNoviceDeclaration = targetClasses.some((c) => ATTESTATION_REQUIRED_DIVISIONS.has(divisionOf(c)));
  const missingNoviceDeclaration = needsNoviceDeclaration && !noviceDeclared;

  const submit = async () => {
    if (targetClasses.length === 0 || !exhibitorId || !horseId) {
      setError(cls ? 'Pick an exhibitor and a horse.' : 'Pick a horse and tick at least one class.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    setWarnings([]);

    const entered: DeskClass[] = [];
    // What the association rules said about each entry that went in.
    const saved: SavedEntry[] = [];
    let refusal: { cls: DeskClass; message: string } | null = null;
    for (const c of targetClasses) {
      const body: Record<string, unknown> = {
        showId,
        classId: c.id,
        exhibitor_id: exhibitorId,
        horse_id: horseId,
        is_disqualified: false,
      };
      // Neither the division nor the relationship to the owner is sent: the
      // endpoint fills both from the class and the horse link.
      if (noviceDeclared && ATTESTATION_REQUIRED_DIVISIONS.has(divisionOf(c))) {
        body.attestations = ['novice_eligibility'];
      }
      // The buy-in rides on each entry it covers, so the two commit together:
      // a pot joined by a separate call before a refused entry would be money
      // owed for a class nobody is in. Joining twice is joining once.
      const pots = potIds.filter((id) => potsForClass(desk, c.id).some((pot) => pot.id === id));
      if (pots.length > 0) body.side_pot_ids = pots;

      try {
        const res = await fetch('/api/entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          refusal = { cls: c, message: backendMessage(payload?.detail ?? payload?.error, 'Could not add that entry.') };
          break;
        }
        entered.push(c);
        const entry = await res.json().catch(() => null);
        if (entry) saved.push(entry);
      } catch {
        refusal = { cls: c, message: 'Network error — please try again.' };
        break;
      }
    }

    // The class entries stand whatever happens next. A failed enrollment is
    // reported against them rather than rolled back, and the panel goes on
    // offering the enrollment until it is made. Only a futurity one of the
    // entered classes belongs to: enrolling for a class that was refused would
    // be a charge for nothing entered.
    const enrollmentProblems: string[] = [];
    if (person) {
      for (const futurity of enrolling) {
        if (!entered.some((c) => futurityForClass(desk, c.id)?.id === futurity.id)) continue;
        const problem = await enrollHorse({
          showId,
          futurity,
          exhibitor: person,
          horseId,
          choice: enrollments[futurity.id] ?? EMPTY_CHOICE,
        });
        if (problem) enrollmentProblems.push(`${futurity.name}: ${problem}`);
      }
    }
    setSaving(false);

    // Clear only what went in; the pinned side is still the job in hand — the
    // rest of this horse's classes, or a queue of riders for class 14.
    if (entered.length > 0) {
      if (exhibitor) {
        const done = new Set(entered.map((c) => c.id));
        setTicked((prev) => prev.filter((id) => !done.has(id)));
      } else {
        setPickedExhibitorId('');
        setHorseId('');
      }
      setEnrollments({});
      setEnrollOff([]);
      setNoviceDeclared(false);
    }

    const horseName = selectedHorse?.name ?? 'The horse';
    const messages: string[] = [];
    if (refusal) {
      const which = `Class ${refusal.cls.class_number} (${refusal.cls.class_name})`;
      messages.push(
        entered.length > 0
          ? `Entered ${entered.length} of ${targetClasses.length}. ${which} was refused: ${refusal.message} The classes still ticked were not entered.`
          : targetClasses.length > 1
            ? `${which} was refused: ${refusal.message} Nothing was entered.`
            : refusal.message,
      );
    }
    if (enrollmentProblems.length > 0) {
      messages.push(`Entered in the class, but the futurity enrollment did not save — ${enrollmentProblems.join('; ')}`);
    }
    setError(messages.length > 0 ? messages.join(' ') : null);
    if (!refusal && entered.length > 1) setNotice(`${horseName} is entered in ${plural(entered.length, 'class')}.`);
    setWarnings(
      warningLines(saved, (classId) => {
        const c = entered.find((e) => e.id === classId);
        return c ? `Class ${c.class_number}` : 'A class';
      }),
    );

    if (entered.length > 0) await onAdded();
  };

  const horsePlaceholder = !exhibitorId
    ? 'Pick an exhibitor first'
    : horsesLoading
      ? 'Loading horses…'
      : horses.length === 0
        ? 'No horses on file'
        : selectableHorses.length === 0
          ? 'All their horses are already in'
          : exhibitor
            ? 'Enter classes on which horse…'
            : 'On which horse…';

  const horsePicker = (
    <select
      value={horseId}
      onChange={(e) => {
        setHorseId(e.target.value);
        setTicked([]);
        setError(null);
        setNotice(null);
        setWarnings([]);
      }}
      disabled={!exhibitorId || horsesLoading || selectableHorses.length === 0}
      aria-label="Horse"
      title={
        !exhibitorId
          ? 'Pick an exhibitor first'
          : !horsesLoading && horses.length === 0
            ? 'This exhibitor has no horses on file — add one from their desk panel'
            : horsesLoading
              ? 'Loading horses…'
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
  );

  const blocked = !exhibitorId || !horseId
    ? cls
      ? 'Pick an exhibitor and a horse first'
      : 'Pick a horse first'
    : targetClasses.length === 0
      ? 'Tick the classes to enter'
      : missingPotChoice
        ? 'A class is in a side pot — tick the pot they are buying into'
        : enrollmentIncomplete
          ? 'Pick the futurity category, or untick the enrollment'
          : null;

  const count = targetClasses.length;
  const extra = enrolling.length > 0 ? ' & enroll' : potIds.length > 0 ? ' & buy in' : '';
  const buttonLabel = saving
    ? 'Adding…'
    : cls || count === 1
      ? `Enter class${extra}`
      : count === 0
        ? 'Enter classes'
        : `Enter ${plural(count, 'class')}${extra}`;

  return (
    <div className="rounded border p-3 space-y-2" style={{ borderColor: COLORS.borderSoft, backgroundColor: 'var(--surface)' }}>
      {exhibitor ? (
        <div className="flex flex-wrap gap-2">{horsePicker}</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <select
            value={pickedExhibitorId}
            onChange={(e) => setPickedExhibitorId(e.target.value)}
            aria-label="Exhibitor"
            className="flex-1 min-w-[220px] border rounded px-3 py-2 text-sm"
            style={{ borderColor: COLORS.border }}
          >
            <option value="">
              {selectableExhibitors.length === 0 ? 'Everyone on the roster is already in' : 'Add an exhibitor…'}
            </option>
            {selectableExhibitors.map((e) => (
              <option key={e.exhibitor_id} value={e.exhibitor_id}>
                {exhibitorNumbers(e).length > 0 ? `#${exhibitorNumbers(e).join(', #')} ` : ''}
                {e.exhibitor_name}
              </option>
            ))}
          </select>
          {horsePicker}
        </div>
      )}

      {/* The pinned exhibitor's horse, and every class it can still enter. */}
      {exhibitor && selectedHorse && (
        offeredClasses.length === 0 ? (
          <p className="text-sm" style={{ color: COLORS.muted }}>
            {selectedHorse.name} is entered in every class still open to it.
          </p>
        ) : (
          <div className="space-y-2">
            {offeredClasses.length > 12 && (
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Find a class by number or name"
                aria-label="Find a class"
                className="w-full border rounded px-3 py-2 text-sm"
                style={{ borderColor: COLORS.border }}
              />
            )}
            {shownByDay.length === 0 && (
              <p className="text-sm" style={{ color: COLORS.muted }}>No class matches &ldquo;{filter.trim()}&rdquo;.</p>
            )}
            <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
              {shownByDay.map(([day, dayClasses]) => (
                <fieldset key={day} className="space-y-0.5">
                  <legend className="text-xs font-semibold uppercase tracking-wide" style={{ color: COLORS.muted }}>
                    {formatDay(day)}
                  </legend>
                  {dayClasses.map((c) => {
                    const on = ticked.includes(c.id);
                    // The only rows left that they are already in are pattern
                    // classes with another horse. Say so, or the entry reads
                    // as the filter having missed one.
                    const ridingAlready = (exhibitor.entries ?? []).some((e) => e.class_id === c.id);
                    const futurity = futurityForClass(desk, c.id);
                    const division = on ? divisionOf(c) : '';
                    const meta = [
                      potsForClass(desk, c.id).length > 0 ? 'side pot' : null,
                      ridingAlready ? 'another horse' : null,
                      division ? `Division: ${divisionLabel(division)}` : null,
                    ].filter(Boolean);
                    const price = futurity
                      ? 'priced by the futurity'
                      : c.is_free
                        ? 'Free'
                        : c.entry_fee_cents > 0
                          ? formatMoney(c.entry_fee_cents)
                          : null;
                    return (
                      <label
                        key={c.id}
                        className="flex items-start gap-2 rounded px-2 py-1 text-sm cursor-pointer"
                        style={{ backgroundColor: on ? 'var(--accent-bg)' : undefined }}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) => {
                            setError(null);
                            setNotice(null);
                            setWarnings([]);
                            setTicked((prev) => (e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id)));
                          }}
                          className="mt-0.5 h-4 w-4 shrink-0"
                        />
                        <span className="flex-1 min-w-0">
                          <span style={{ color: COLORS.text }}>
                            <span className="font-mono" style={{ color: COLORS.accent }}>{c.class_number}</span> {c.class_name}
                          </span>
                          {meta.length > 0 && (
                            <span className="block text-xs" style={{ color: COLORS.muted }}>{meta.join(' · ')}</span>
                          )}
                        </span>
                        {price && (
                          <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-deep)' }}>{price}</span>
                        )}
                      </label>
                    );
                  })}
                </fieldset>
              ))}
            </div>
          </div>
        )
      )}

      {/* Stated, not asked: it goes on the entry and is reported to APHA, so
          the desk should see what is being filed — but it follows from the
          class, and a control with one correct answer is not a question. */}
      {cls && divisionOf(cls) && (
        <p
          className="text-xs"
          style={{ color: 'var(--text-deep)' }}
          title="Filed on the entry and reported to APHA. It follows from the class's bracket, set when the class was built."
        >
          Division: <strong>{divisionLabel(divisionOf(cls))}</strong>
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
          <span style={{ color: 'var(--text-deep)' }}>
            {NOVICE_ELIGIBILITY_STATEMENT}
            {missingNoviceDeclaration && (
              <span className="block mt-1" style={{ color: 'var(--muted)' }}>
                Not ticked, the entry still goes in and is flagged for the office.
              </span>
            )}
          </span>
        </label>
      )}

      {/* The buy-ins that come with these classes. Listed whether or not
          anything is being asked for: a pot they are already in is the answer
          to "why is this class not asking for $50", and a settled pot is not
          offered at all because nobody can be added to it. */}
      {coveringPots.length > 0 && (
        <div
          className="rounded border p-2 space-y-1.5"
          style={
            potRequired
              ? { borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)' }
              : { borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }
          }
        >
          <p className="text-xs font-semibold" style={{ color: 'var(--text-deep)' }}>
            {potRequired
              ? coveringPots.length === 1
                ? `${count > 1 ? 'A class here is' : 'This class is'} in a side pot — the buy-in comes with it`
                : 'These classes are in side pots — pick the ones they are buying into'
              : `${count > 1 ? 'A class here is' : 'This class is'} in a side pot`}
          </p>
          {coveringPots.map((pot) => {
            const alreadyIn = (person?.side_pot_ids ?? []).includes(pot.id);
            return (
              <label key={pot.id} className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-deep)' }}>
                <input
                  type="checkbox"
                  checked={alreadyIn || potIds.includes(pot.id)}
                  disabled={alreadyIn}
                  onChange={(e) =>
                    setPotIds((prev) => (e.target.checked ? [...prev, pot.id] : prev.filter((id) => id !== pot.id)))
                  }
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span>
                  <strong>{pot.name}</strong> — {formatMoney(pot.entry_fee_cents)} buy-in
                  {alreadyIn ? (
                    <span style={{ color: COLORS.muted }}> · already in, nothing more to pay</span>
                  ) : (
                    <span style={{ color: COLORS.muted }}> · one buy-in covers every class in the pot</span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {enrolledIn.map((futurity) => {
        const existing = futurityEnrollment(person, futurity.id, horseId);
        return (
          <p key={futurity.id} className="text-xs" style={{ color: COLORS.muted }}>
            Priced by {futurity.name}: {existing?.fee_tier_name ?? 'enrolled'}
            {existing && existing.tier_amount_cents > 0 && ` — ${formatMoney(existing.tier_amount_cents)} per class`}.
          </p>
        );
      })}

      {toEnroll.map((futurity) => {
        const on = !enrollOff.includes(futurity.id);
        return (
          <div
            key={futurity.id}
            className="rounded border p-2 space-y-2"
            style={{ borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)' }}
          >
            <label className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-deep)' }}>
              <input
                type="checkbox"
                checked={on}
                onChange={(e) =>
                  setEnrollOff((prev) =>
                    e.target.checked ? prev.filter((id) => id !== futurity.id) : [...prev, futurity.id],
                  )
                }
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <span>
                Enroll this horse in <strong>{futurity.name}</strong> too. Its classes have no fee of their own —
                the futurity category prices them, so without the enrollment nothing is billed for them.
              </span>
            </label>
            {on && (
              <EnrollmentFields
                futurity={futurity}
                value={enrollments[futurity.id] ?? EMPTY_CHOICE}
                onChange={(choice) => setEnrollments((prev) => ({ ...prev, [futurity.id]: choice }))}
                idPrefix={`add-entry-${futurity.id}`}
              />
            )}
          </div>
        );
      })}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {notice && !error && (
        <p className="text-sm" role="status" style={{ color: 'var(--success-strong)' }}>
          {notice}
        </p>
      )}
      {/* Entered all the same: whether the association's rules hold here is
          the office's call, so they are said once and left to it. They stay on
          the show's readiness panel too. */}
      {warnings.length > 0 && (
        <div
          className="text-xs rounded border p-2"
          style={{ backgroundColor: 'var(--warning-bg)', borderColor: 'var(--warning-border)', color: 'var(--warning)' }}
        >
          <p className="font-medium">Entered — the association rules flag:</p>
          <ul className="list-disc pl-4 mt-1 space-y-0.5">
            {warnings.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {(cls || selectedHorse) && (
        <button
          type="button"
          onClick={submit}
          disabled={Boolean(blocked) || saving}
          title={saving ? 'Adding, please wait…' : blocked ?? undefined}
          className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: COLORS.dark, color: COLORS.onDark }}
        >
          {buttonLabel}
        </button>
      )}
    </div>
  );
}
