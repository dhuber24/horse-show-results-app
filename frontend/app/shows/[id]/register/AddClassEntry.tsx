'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ATTESTATION_REQUIRED_DIVISIONS,
  NOVICE_ELIGIBILITY_STATEMENT,
  RELATIONSHIP_REQUIRED_DIVISIONS,
  divisionLabel,
} from '@/lib/apha';
import { warningLines } from '@/lib/association-warnings';
import {
  formatMoney,
  healthWarnings,
  unmetSidePots,
  type ExistingEntry,
  type PreviewClass,
  type PreviewHorse,
  type PreviewSidePot,
} from './types';

/**
 * Enter one horse in several classes in one press.
 *
 * Pick the horse, tick its classes, press the button. The desk's form
 * (`admin/shows/[id]/desk/AddEntryForm`) is the same shape with the exhibitor
 * chosen by staff. It was one class per press, which made somebody entering
 * eight classes on the same horse pick the horse eight times; a horse is how
 * an entry blank is filled in, so the horse comes first and its classes are a
 * checklist.
 *
 * **Not the page-long batch form this replaced before that**, which listed
 * every class with a horse select on each row and reported a clash — a closed
 * class, a horse already in — only after the lot was filled in. The checklist
 * offers only what this horse can still enter, filtered the way the desk
 * filters: a class this horse is in is gone, a class the exhibitor is in on
 * another horse is gone unless it is a pattern class (judged run by run, so
 * one exhibitor may show two horses in it), and a class under way or already
 * run is gone. So what is ticked is what goes in, and the press is all or
 * nothing: `POST /shows/{id}/register` commits the batch together or refuses
 * it naming the class. An APHA or AQHA rule is not a refusal: the entry goes in
 * and what the rules said comes back beside the "entered" line, for the show
 * office to take up.
 *
 * Championship classes are left out entirely, and that one is not a filter on
 * this exhibitor: a Grand & Reserve Champion class calls back the top two from
 * each qualifying class, so nobody enters it and the POST refuses it from
 * anybody. Counted and explained apart from "you are already in it" below,
 * because the two read completely differently to the person reading the list.
 *
 * It posts to the exhibitor's own endpoint, not the staff one. Same rules,
 * different door: `POST /shows/{id}/register` derives the exhibitor from the
 * session, so this cannot be pointed at anybody else.
 *
 * **No division picker and no relationship picker.** The class already answers
 * the APHA division — `divisions_for_bracket` reads it off the bracket — so a
 * ticked class states it. The relationship to the horse's owner is answered
 * once, per horse, on the wizard's horses step, and usually not even there: a
 * horse the exhibitor owns is "Self", and the horse's record already says so.
 */

function backendMessage(detail: unknown, fallback: string): string {
  if (typeof detail === 'string') return detail;
  const d = detail as {
    code?: string;
    message?: string;
    issues?: { severity: string; message: string }[];
  };
  if (d?.code === 'ASSOCIATION_VALIDATION_FAILED' && Array.isArray(d.issues)) {
    const issues = d.issues.filter((i) => i.severity === 'error').map((i) => i.message).join(' ');
    // The batch is refused whole, so the class it was refused over is the
    // first thing to say: that is the one to untick.
    return d.message ? `${d.message}: ${issues}` : issues;
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

/** What one entry in this class adds to the bill: its entry fee, a club's
 *  per-class fee, and the show's per-class fees — the figure the class then
 *  shows on the bill. Side pot buy-ins are quoted apart. A free class is
 *  nothing, whatever else is configured. */
function classCostCents(cls: PreviewClass): number {
  if (cls.is_free) return 0;
  const perClass = (cls.per_class_charges ?? []).reduce((sum, charge) => sum + charge.cents, 0);
  return cls.entry_fee_cents + cls.sanction_cents + perClass;
}

function priceLabel(cls: PreviewClass): string | null {
  if (cls.is_free) return 'Free';
  const cents = classCostCents(cls);
  return cents > 0 ? formatMoney(cents) : null;
}

function plural(n: number, one: string, many = `${one}es`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The buy-ins the ticked classes oblige. A class an open pot bundles has to
 * come with a buy-in to one of its pots; one covering pot is not a choice, so
 * it is ticked, and several are, so they are left for the exhibitor. Choices
 * already made are kept while a ticked class still needs the pot.
 */
function reconcilePots(classes: PreviewClass[], chosen: string[]): string[] {
  const covering = new Set(classes.flatMap((c) => unmetSidePots(c).map((pot) => pot.id)));
  const next = chosen.filter((id) => covering.has(id));
  for (const cls of classes) {
    const unmet = unmetSidePots(cls);
    if (unmet.length === 1 && !next.includes(unmet[0].id)) next.push(unmet[0].id);
  }
  return next;
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
  // One horse is not a choice.
  const [horseId, setHorseId] = useState(horses.length === 1 ? horses[0].id : '');
  const [ticked, setTicked] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [noviceDeclared, setNoviceDeclared] = useState(false);
  const [potIds, setPotIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const isApha = showTypeCode === 'APHA';
  const selectedHorse = horses.find((h) => h.id === horseId);
  // A horse taken off the registration since it was picked is no horse.
  const activeHorseId = selectedHorse ? horseId : '';

  const horseIdsByClass = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const e of existingEntries) {
      const list = map.get(e.class_id) ?? [];
      if (e.horse_id) list.push(e.horse_id);
      map.set(e.class_id, list);
    }
    return map;
  }, [existingEntries]);

  // Two reasons a class is not on offer to anybody, and they read differently
  // to the exhibitor, so they are counted apart.
  //
  // A Grand & Reserve Champion class is never enterable: the top two from each
  // qualifying class are called back to it once those classes have been
  // judged. Leaving it in the list offers something the POST refuses, and the
  // exhibitor has no way to work out why from the class name alone.
  const qualificationClasses = useMemo(
    () => classes.filter((c) => c.entered_by_qualification),
    [classes],
  );

  // At a running show: a class in the ring or already run. Entering one is the
  // in-gate's and the office's to sort out (`backend/self_entry.py`), so it is
  // left out rather than offered and refused.
  const startedClasses = useMemo(
    () => classes.filter((c) => !c.entered_by_qualification && (c.under_way || c.completed)),
    [classes],
  );

  const openClasses = useMemo(
    () => classes.filter((c) => !c.entered_by_qualification && !c.under_way && !c.completed),
    [classes],
  );

  // What this horse can still enter. Mirrors `selectableClasses` on the desk
  // form; the backend 409s on the rest either way. Being entered finishes a
  // class — the horse's own entry always (`entries_class_horse_uniq`), the
  // exhibitor's entry on another horse unless it is a pattern class.
  const offered = useMemo(() => {
    if (!activeHorseId) return [];
    return openClasses.filter((c) => {
      const taken = horseIdsByClass.get(c.id) ?? [];
      if (taken.includes(activeHorseId)) return false;
      return taken.length === 0 || c.score_type === 'pattern';
    });
  }, [openClasses, horseIdsByClass, activeHorseId]);

  // Classes dropped from the list because this exhibitor is done with them.
  // Worth saying out loud: somebody looking for a class they entered an hour
  // ago should not be left wondering whether the show pulled it.
  const enteredCount = activeHorseId ? openClasses.length - offered.length : 0;

  const needle = filter.trim().toLowerCase();
  const shown = useMemo(
    () =>
      needle
        ? offered.filter(
            (c) =>
              c.class_number.toLowerCase().startsWith(needle) ||
              c.class_name.toLowerCase().includes(needle) ||
              ticked.includes(c.id),
          )
        : offered,
    [offered, needle, ticked],
  );

  // Grouped by day — an exhibitor is reading a schedule and picking a Saturday.
  const byDay = useMemo(() => {
    const grouped = new Map<string, PreviewClass[]>();
    for (const c of shown) {
      const list = grouped.get(c.class_date) ?? [];
      list.push(c);
      grouped.set(c.class_date, list);
    }
    return Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [shown]);

  // Only what is still on offer counts as ticked: a reload that brings a class
  // back as entered must not leave it in the next press.
  const tickedClasses = useMemo(
    () => offered.filter((c) => ticked.includes(c.id)),
    [offered, ticked],
  );

  // The division comes off the class, never off a picker — see the header.
  const aphaDivisionOf = (cls: PreviewClass) => (isApha && cls.apha_divisions?.[0]) || '';

  const needsNoviceDeclaration = tickedClasses.some((c) => ATTESTATION_REQUIRED_DIVISIONS.has(aphaDivisionOf(c)));
  // Offered, never required: an association rule flags an entry and does not
  // refuse it, so a Novice class goes in undeclared and comes back flagged.
  const missingNoviceDeclaration = needsNoviceDeclaration && !noviceDeclared;
  // Answered on the horses step. Missing is a prompt with a destination, never
  // a block: the backend takes the entry either way and the office chases it.
  const missingRelationship =
    Boolean(selectedHorse) &&
    !selectedHorse?.relationship_to_owner &&
    tickedClasses.some((c) => RELATIONSHIP_REQUIRED_DIVISIONS.has(aphaDivisionOf(c)));

  // The side pots the ticked classes are in, once each however many of their
  // classes are ticked: one buy-in covers every class the pot names.
  const coveringPots = useMemo(() => {
    const byId = new Map<string, PreviewSidePot>();
    for (const cls of tickedClasses) for (const pot of cls.side_pots ?? []) byId.set(pot.id, pot);
    return Array.from(byId.values());
  }, [tickedClasses]);
  const unmetPotIds = new Set(tickedClasses.flatMap((c) => unmetSidePots(c).map((pot) => pot.id)));
  const missingPotChoice = tickedClasses.some((c) => {
    const unmet = unmetSidePots(c);
    return unmet.length > 0 && !unmet.some((pot) => potIds.includes(pot.id));
  });
  const potTotalCents = coveringPots
    .filter((pot) => !pot.joined && potIds.includes(pot.id))
    .reduce((sum, pot) => sum + pot.entry_fee_cents, 0);
  const classTotalCents = tickedClasses.reduce((sum, c) => sum + classCostCents(c), 0);

  const setTicks = (next: string[]) => {
    setTicked(next);
    setError(null);
    setNotice(null);
    setPotIds((prev) => reconcilePots(offered.filter((c) => next.includes(c.id)), prev));
  };

  const toggle = (classId: string, on: boolean) =>
    setTicks(on ? [...ticked, classId] : ticked.filter((id) => id !== classId));

  const chooseHorse = (id: string) => {
    setHorseId(id);
    setTicked([]);
    setPotIds([]);
    setError(null);
    setNotice(null);
  };

  const submit = async () => {
    if (!selectedHorse || tickedClasses.length === 0) {
      setError('Pick a horse and tick at least one class.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    setWarnings([]);

    const entries = tickedClasses.map((cls) => {
      const entry: Record<string, unknown> = { class_id: cls.id, horse_id: selectedHorse.id };
      const division = aphaDivisionOf(cls);
      if (division) entry.apha_division = division;
      // `relationship_to_owner` is deliberately not sent. The backend reads it
      // off this show's registration, which is where the horses step wrote it.
      if (noviceDeclared && ATTESTATION_REQUIRED_DIVISIONS.has(division)) {
        entry.attestations = ['novice_eligibility'];
      }
      // Each buy-in rides on the classes it covers, so the pot and the entries
      // it was bought for commit together or not at all.
      const pots = potIds.filter((id) => (cls.side_pots ?? []).some((pot) => pot.id === id));
      if (pots.length > 0) entry.side_pot_ids = pots;
      return entry;
    });

    try {
      const res = await fetch(`/api/shows/${showId}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      });
      setSaving(false);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(
          backendMessage(
            payload?.detail ?? payload?.error,
            entries.length === 1 ? 'Could not enter that class.' : 'Could not enter those classes — none were entered.',
          ),
        );
        return;
      }
      // The horse carries over — somebody entering a second horse picks it —
      // and the ticks clear, because those classes are entered now.
      setNotice(`${selectedHorse.name} is entered in ${plural(entries.length, 'class')}.`);
      const saved = await res.json().catch(() => null);
      setWarnings(
        warningLines(saved?.created_entries ?? [], (classId) => {
          const cls = classes.find((c) => c.id === classId);
          return cls ? `Class ${cls.class_number} (${cls.class_name})` : 'A class';
        }),
      );
      setTicked([]);
      // The reload brings each buy-in back as a pot already joined, so the
      // next class in it asks for nothing.
      setPotIds([]);
      setNoviceDeclared(false);
      onAdded();
    } catch {
      setSaving(false);
      setError('Network error — please try again.');
    }
  };

  const nothingLeft = Boolean(activeHorseId) && offered.length === 0;
  const blocked = !activeHorseId
    ? 'Pick a horse first'
    : tickedClasses.length === 0
      ? 'Tick the classes to enter'
      : missingPotChoice
        ? 'A ticked class comes with a side pot — tick the pot you are buying into'
        : null;

  return (
    <div
      className="rounded border p-3 space-y-3"
      style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface)' }}
    >
      <select
        value={horseId}
        onChange={(e) => chooseHorse(e.target.value)}
        aria-label="Horse"
        className="w-full sm:w-auto sm:min-w-[260px] border rounded px-3 py-2 text-sm"
        style={{ borderColor: 'var(--border)' }}
      >
        <option value="">Enter classes on which horse…</option>
        {horses.map((h) => (
          <option key={h.id} value={h.id}>
            {h.name}
            {/* Marked, never enforced — the panel above says what is due. */}
            {healthWarnings(h).length > 0 ? ' ⚠ records due' : ''}
          </option>
        ))}
      </select>

      {activeHorseId && nothingLeft && (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {selectedHorse?.name} is entered in every class still open to it.
        </p>
      )}

      {activeHorseId && !nothingLeft && (
        <>
          {offered.length > 12 && (
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Find a class by number or name"
              aria-label="Find a class"
              className="w-full border rounded px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            />
          )}

          <div className="space-y-3">
            {byDay.length === 0 && (
              <p className="text-sm" style={{ color: 'var(--muted)' }}>
                No class matches &ldquo;{filter.trim()}&rdquo;.
              </p>
            )}
            {byDay.map(([day, dayClasses]) => (
              <fieldset key={day} className="space-y-1">
                <legend className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                  {formatDay(day)}
                </legend>
                {dayClasses.map((c) => {
                  const on = ticked.includes(c.id);
                  const price = priceLabel(c);
                  // The only classes left that the exhibitor is already in are
                  // pattern classes on another horse. Say so, or the row reads
                  // as the filter having missed one.
                  const ridingAlready = (horseIdsByClass.get(c.id) ?? []).length > 0;
                  const division = on ? aphaDivisionOf(c) : '';
                  const meta = [
                    c.sanctioning_codes.length > 0 ? c.sanctioning_codes.join(', ') : null,
                    (c.side_pots ?? []).length > 0 ? 'side pot' : null,
                    ridingAlready ? 'another horse' : null,
                    division ? `Division: ${divisionLabel(division)}` : null,
                  ].filter(Boolean);
                  return (
                    <label
                      key={c.id}
                      className="flex items-start gap-2 rounded px-2 py-1.5 text-sm cursor-pointer"
                      style={{ backgroundColor: on ? 'var(--accent-bg)' : undefined }}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => toggle(c.id, e.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0"
                      />
                      <span className="flex-1 min-w-0">
                        <span style={{ color: 'var(--foreground)' }}>
                          <span className="font-mono" style={{ color: 'var(--accent)' }}>{c.class_number}</span>{' '}
                          {c.class_name}
                        </span>
                        {meta.length > 0 && (
                          <span
                            className="block text-xs"
                            style={{ color: 'var(--muted)' }}
                            title={division ? "Filed on the entry and reported to APHA. It follows from the class's bracket, so there is nothing to choose." : undefined}
                          >
                            {meta.join(' · ')}
                          </span>
                        )}
                      </span>
                      {price && (
                        <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-deep)' }}>
                          {price}
                        </span>
                      )}
                    </label>
                  );
                })}
              </fieldset>
            ))}
          </div>
        </>
      )}

      {enteredCount > 0 && !nothingLeft && (
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          {enteredCount === 1 ? '1 class is' : `${enteredCount} classes are`} off this list —
          you&apos;re already entered, see above.
        </p>
      )}

      {startedClasses.length > 0 && (
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          {startedClasses.length === 1 ? '1 class has' : `${startedClasses.length} classes have`}{' '}
          already started or finished and {startedClasses.length === 1 ? 'is' : 'are'} not listed —
          ask at the in-gate or the show office about a late entry.
        </p>
      )}

      {/* Said once, under the list, rather than as an error — because nobody can
          tick one: the class is not there. Without this line a Grand & Reserve
          class simply is missing, and an exhibitor reading the printed show
          bill beside the screen has no way to tell a rule from a lost class. */}
      {qualificationClasses.length > 0 && (
        <p
          className="text-xs"
          style={{ color: 'var(--muted)' }}
          title="A Grand or Reserve Champion class is placed into, not entered: once the qualifying classes have been judged, the top two from each are called back. Enter the qualifying class and the show office takes it from there."
        >
          {qualificationClasses.length === 1
            ? '1 championship class is'
            : `${qualificationClasses.length} championship classes are`}{' '}
          not listed — the show calls back the top two from each qualifying class.
        </p>
      )}

      {/* A prompt with a destination, never a block — the entry goes in either
          way and the office chases it, the same as a membership card. */}
      {missingRelationship && selectedHorse && (
        <p
          className="text-xs rounded border p-2"
          style={{ backgroundColor: 'var(--warning-bg)', borderColor: 'var(--warning-border)', color: 'var(--warning)' }}
        >
          APHA asks how you&apos;re related to {selectedHorse.name}&apos;s owner. Set it once on{' '}
          <Link href="#registration-horses" className="font-medium underline" style={{ color: 'var(--accent)' }}>
            your horses
          </Link>{' '}
          — it carries onto every class.
        </p>
      )}

      {/* The buy-ins that come with the ticked classes, with their prices,
          before the press: this is money, and finding out from a refusal is the
          worst way to be told. A pot already bought into is listed too — it is
          the answer to why its classes are not asking for another $50. */}
      {coveringPots.length > 0 && (
        <div
          className="rounded border p-2 space-y-1.5"
          style={
            unmetPotIds.size > 0
              ? { borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)' }
              : { borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }
          }
        >
          <p className="text-xs font-semibold" style={{ color: 'var(--text-deep)' }}>
            {unmetPotIds.size === 0
              ? 'Your ticked classes are in a side pot you have already bought into'
              : 'Ticked classes are part of a side pot — the buy-in comes with them'}
          </p>
          {coveringPots.map((pot) => (
            <label key={pot.id} className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-deep)' }}>
              <input
                type="checkbox"
                checked={pot.joined || potIds.includes(pot.id)}
                disabled={pot.joined}
                onChange={(e) =>
                  setPotIds((prev) => (e.target.checked ? [...prev, pot.id] : prev.filter((id) => id !== pot.id)))
                }
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <span>
                <strong>{pot.name}</strong> — {formatMoney(pot.entry_fee_cents)} buy-in
                {pot.joined ? (
                  <span style={{ color: 'var(--muted)' }}> · you&rsquo;re in, nothing more to pay</span>
                ) : (
                  <span style={{ color: 'var(--muted)' }}>
                    {' '}
                    · one buy-in covers every class in the pot, and settles with your show bill
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}

      {needsNoviceDeclaration && (
        <label
          className="flex items-start gap-2 text-xs rounded border p-2"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
        >
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
                You can enter without it; the show office may ask you about it.
              </span>
            )}
          </span>
        </label>
      )}

      {/* Said where the press is: in the bar below while it is on screen, in
          its place here once a horse has nothing left to enter. */}
      {!(activeHorseId && !nothingLeft) && <Outcome error={error} notice={notice} warnings={warnings} />}

      {/* The press rides the bottom of the screen while the list is in view: a
          show runs a hundred and fifty classes, and the button that uses the
          ticks must not be eight screens down from the class just ticked. Why
          it is shut is said in the bar, since a phone has no tooltip. */}
      {activeHorseId && !nothingLeft && (
        <div
          className="sticky bottom-0 z-10 -mx-3 -mb-3 px-3 py-2 border-t rounded-b space-y-1"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
        >
          <Outcome error={error} notice={notice} warnings={warnings} />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={Boolean(blocked) || saving}
              title={saving ? 'Entering, please wait…' : blocked ?? undefined}
              className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              {saving
                ? 'Entering…'
                : tickedClasses.length === 0
                  ? 'Enter classes'
                  : `Enter ${tickedClasses.length === 1 ? 'class' : plural(tickedClasses.length, 'class')}${
                      potTotalCents > 0 ? ' & buy in' : ''
                    }`}
            </button>
            {tickedClasses.length > 0 && (
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                {/* Everything these entries add, per-class fees included. The pot
                    buy-in is named apart: it is a different thing being bought,
                    it covers more than these classes, and it settles separately. */}
                {classTotalCents > 0 ? `${formatMoney(classTotalCents)} added to your bill` : 'No entry fee'}
                {potTotalCents > 0 ? ` · ${formatMoney(potTotalCents)} side pot buy-in` : ''}
              </span>
            )}
          </div>
          {tickedClasses.length > 0 && blocked && missingPotChoice && (
            <p className="text-xs" style={{ color: 'var(--warning)' }}>
              {blocked} — under the class list.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Outcome({
  error,
  notice,
  warnings,
}: {
  error: string | null;
  notice: string | null;
  warnings: string[];
}) {
  if (error) return <p className="text-sm" style={{ color: 'var(--error)' }}>{error}</p>;
  if (!notice) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm" role="status" style={{ color: 'var(--success-strong)' }}>
        {notice}
      </p>
      {/* Entered all the same: the association's rules are the show office's
          to apply, so they are said here and chased at the desk. */}
      {warnings.length > 0 && (
        <div
          className="text-xs rounded border p-2"
          style={{ backgroundColor: 'var(--warning-bg)', borderColor: 'var(--warning-border)', color: 'var(--warning)' }}
        >
          <p className="font-medium">The show office may ask you about:</p>
          <ul className="list-disc pl-4 mt-1 space-y-0.5">
            {warnings.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
