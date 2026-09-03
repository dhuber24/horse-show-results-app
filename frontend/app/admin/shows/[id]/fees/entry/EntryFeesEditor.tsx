'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ShowChargesEditor, { type ShowCharge } from '@/components/ShowChargesEditor';

/**
 * Entry Fees: everything a class fee can mean, in one "Class Fees" box —
 * what each class costs to enter, plus the charges the show adds on top (an
 * office fee, an association assessment, an all-day pass, a jackpot fee). No
 * class fee lives in a box outside this one.
 *
 * The per-horse and per-judge tables that used to live here were a second
 * implementation of the same `show_fees` editing that setup Step 5 needed, in a
 * different vocabulary — and one of them wrote a `per_judge` unit that did not
 * say what it multiplied by. Both screens now render `ShowChargesEditor`, so
 * there is one shape for a charge and one place it is written. Here it renders
 * `boxed={false}`, sharing this screen's single outer border with the
 * per-class pricing table below it rather than drawing a second one.
 *
 * The office charge had its own card here with its own state and its own save
 * button, because it was a column on `shows` rather than a fee row. Migration
 * 132 made it an ordinary `per_exhibitor` / `per_horse` fee, so the card is
 * gone — it is a row in the list like every other charge.
 */

interface ClassItem {
  id: string;
  class_number: string;
  class_name: string;
  entry_fee_cents: number;
  sort_order: number | null;
  /** Which clubs sanction this class (migration 113). A class carrying any of
   *  these already has its own price, set by the club, and is a different
   *  question from the breed association's own class list — see the default
   *  price fill below. */
  sanctioning_codes: string[];
  /** Reached by placing, not by entering (migration 129) — a Grand & Reserve
   *  callback has nobody to price. */
  entered_by_qualification: boolean;
  /** Priced by its futurity's own fee tier, never by the class row — a
   *  futurity class carries `entry_fee_cents = 0` on purpose, and the default
   *  fill must not be the thing that quietly doubles a futurity entrant's
   *  bill. */
  is_futurity_class: boolean;
}

interface Props {
  showId: string;
  initialCharges: ShowCharge[];
  initialClasses: ClassItem[];
  judgeCount: number;
}

function dollarsFromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

function centsFromDollars(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(parseFloat(trimmed) * 100);
}

// ── Per-class entry fees ──────────────────────────────────────────────────────

/** Whether the default-fill button may set this class's price.
 *
 * Excludes three things that all look the same from here — "$0, not priced
 * yet" — but are not the same absence:
 * - a club-sanctioned class (`sanctioning_codes`), which already has its own
 *   price set by that club;
 * - a Grand & Reserve callback (`entered_by_qualification`), which nobody
 *   enters directly and so has nothing to price;
 * - a futurity class (`is_futurity_class`), which is priced by the
 *   futurity's own fee tier and would be billed twice if this filled it in.
 */
function isDefaultFillable(cls: ClassItem): boolean {
  return (
    cls.entry_fee_cents === 0 &&
    cls.sanctioning_codes.length === 0 &&
    !cls.entered_by_qualification &&
    !cls.is_futurity_class
  );
}

function ClassFeesTable({ showId, initialClasses }: { showId: string; initialClasses: ClassItem[] }) {
  const router = useRouter();
  const [classes, setClasses] = useState(initialClasses);
  const [drafts, setDrafts] = useState<Record<string, string>>(
    Object.fromEntries(initialClasses.map((c) => [c.id, dollarsFromCents(c.entry_fee_cents)])),
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveClass = async (cls: ClassItem) => {
    const cents = centsFromDollars(drafts[cls.id] ?? '');
    if (cents === null) { setError(`Invalid amount for class ${cls.class_number}.`); return; }
    if (cents === cls.entry_fee_cents) return;
    setSavingId(cls.id);
    setError(null);
    const res = await fetch('/api/classes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId, classId: cls.id, entry_fee_cents: cents }),
    });
    setSavingId(null);
    if (res.ok) {
      setClasses((prev) => prev.map((c) => (c.id === cls.id ? { ...c, entry_fee_cents: cents } : c)));
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? `Failed to save fee for class ${cls.class_number}.`);
    }
  };

  // ── Default price for the breed association's own classes ──────────────────
  //
  // A club's "All Breed" classes (WSCA, MNSPHC and the like) already carry
  // their own price — that is `sanctioning_codes` — and are not touched here.
  // What this fills is everything else: the breed association's own class
  // list, which is routinely priced the same across most of it ($36.00 flat,
  // on a real APHA show bill) and was otherwise 130-odd rows to type by hand.
  //
  // Only classes still at $0 are filled, never overwritten — APHA fees differ
  // by division on purpose, and a blind "apply to everything" would flatten
  // whatever a secretary had already customized. Filling in one $0 at a time
  // is the same shape of work `ClassWizardClient`'s cell-click queue already
  // does for a reason: a couple hundred sequential PATCHes from the browser
  // beats a bespoke bulk endpoint for something run once per show setup.
  const [defaultDollars, setDefaultDollars] = useState('');
  const [filling, setFilling] = useState(false);
  const [fillResult, setFillResult] = useState<string | null>(null);

  const fillDefaultPrice = async () => {
    const cents = centsFromDollars(defaultDollars);
    if (cents === null) { setError('Invalid default amount.'); return; }
    const targets = classes.filter(isDefaultFillable);
    if (targets.length === 0) {
      setFillResult('Nothing to fill — every breed-association class already has a price.');
      return;
    }
    setFilling(true);
    setError(null);
    setFillResult(null);
    let filled = 0;
    let failed = 0;
    for (const cls of targets) {
      const res = await fetch('/api/classes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showId, classId: cls.id, entry_fee_cents: cents }),
      });
      if (res.ok) {
        filled += 1;
        setClasses((prev) => prev.map((c) => (c.id === cls.id ? { ...c, entry_fee_cents: cents } : c)));
        setDrafts((prev) => ({ ...prev, [cls.id]: dollarsFromCents(cents) }));
      } else {
        failed += 1;
      }
    }
    setFilling(false);
    setFillResult(
      failed === 0
        ? `Filled ${filled} class${filled === 1 ? '' : 'es'} at ${dollarsFromCents(cents)} each.`
        : `Filled ${filled}, ${failed} failed — try those rows individually below.`,
    );
    router.refresh();
  };

  if (classes.length === 0) {
    return (
      <div className="pt-3 border-t" style={{ borderColor: '#e8d5b7' }}>
        <h3 className="text-sm font-semibold mb-1" style={{ color: '#2c1810' }}>Per-class pricing</h3>
        <p className="text-sm" style={{ color: '#8b7355' }}>
          No classes yet. Add classes from the Show home page, then come back to set fees.
        </p>
      </div>
    );
  }

  const unpricedBreedCount = classes.filter(isDefaultFillable).length;

  return (
    <div className="pt-3 border-t space-y-3" style={{ borderColor: '#e8d5b7' }}>
      <h3 className="text-sm font-semibold" style={{ color: '#2c1810' }}>Per-class pricing</h3>
      <p className="text-xs" style={{ color: '#8b7355' }}>
        Charged once per entry (per class per horse). A class a club sanctions outright — WSCA,
        MNSPHC and the like — carries that club&apos;s own price and is not touched by the
        default below; each association charges its own.
      </p>

      {unpricedBreedCount > 0 && (
        <div
          className="rounded border p-2.5 space-y-1.5"
          style={{ borderColor: '#e8d5b7', backgroundColor: '#faf7f2' }}
        >
          <p className="text-xs" style={{ color: '#8b7355' }}>
            <strong>{unpricedBreedCount}</strong> breed-association class
            {unpricedBreedCount === 1 ? '' : 'es'} still {unpricedBreedCount === 1 ? 'has' : 'have'} no
            price. Fill them all at once rather than typing the same amount {unpricedBreedCount}{' '}
            times — this never touches a class that already has a price, or one a club sanctions.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative w-24">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: '#8b7355' }}>$</span>
              <input
                inputMode="decimal"
                value={defaultDollars}
                onChange={(e) => setDefaultDollars(e.target.value)}
                aria-label="Default price for unpriced breed-association classes"
                placeholder="e.g. 36.00"
                className="w-full border rounded pl-5 pr-2 py-1 text-sm"
                style={{ borderColor: '#d4b896' }}
              />
            </div>
            <button
              onClick={fillDefaultPrice}
              disabled={filling || defaultDollars.trim() === ''}
              className="text-xs px-2.5 py-1.5 rounded font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: '#8b4513' }}
            >
              {filling ? 'Filling…' : `Fill ${unpricedBreedCount} class${unpricedBreedCount === 1 ? '' : 'es'}`}
            </button>
            {fillResult && (
              <span className="text-xs" style={{ color: '#5d4a37' }}>{fillResult}</span>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
      <ul className="divide-y" style={{ borderColor: '#e8d5b7' }}>
        {classes.map((cls) => {
          const draft = drafts[cls.id] ?? '';
          const parsed = centsFromDollars(draft);
          const invalid = parsed === null;
          const dirty = !invalid && parsed !== cls.entry_fee_cents;
          return (
            <li key={cls.id} className="flex items-center gap-3 py-2">
              <div className="flex-1 min-w-0">
                <span className="text-xs font-mono mr-2 px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: '#f0e8d8', color: '#8b4513' }}>
                  #{cls.class_number}
                </span>
                <span className="text-sm" style={{ color: '#2c1810' }}>{cls.class_name}</span>
                {cls.sanctioning_codes.length > 0 && (
                  <span
                    className="ml-2 text-xs px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: '#fef3c7', color: '#92400e' }}
                    title="Priced by the club, not by the breed-association default above"
                  >
                    {cls.sanctioning_codes.join(', ')}
                  </span>
                )}
                {cls.entered_by_qualification && (
                  <span
                    className="ml-2 text-xs px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: '#f0e8d8', color: '#8b4513' }}
                    title="Reached by placing, not by entering — nobody signs up for this one"
                  >
                    by qualification
                  </span>
                )}
                {cls.is_futurity_class && (
                  <span
                    className="ml-2 text-xs px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: '#f0e8d8', color: '#8b4513' }}
                    title="Priced by its futurity's own fee tier — a price here would double-charge it"
                  >
                    futurity
                  </span>
                )}
                {(cls.entered_by_qualification || cls.is_futurity_class) && cls.entry_fee_cents > 0 && (
                  <span
                    className="ml-2 text-xs px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }}
                    title="This carries a price despite being reached by qualification or priced by a futurity — check it belongs"
                  >
                    ⚠ priced anyway
                  </span>
                )}
              </div>
              <div className="relative w-24">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: '#8b7355' }}>$</span>
                <input
                  inputMode="decimal"
                  value={draft}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [cls.id]: e.target.value }))}
                  aria-label={`Entry fee for class ${cls.class_number}`}
                  className="w-full border rounded pl-5 pr-2 py-1 text-sm"
                  style={{ borderColor: invalid ? '#fca5a5' : '#d4b896' }}
                />
              </div>
              <button
                onClick={() => saveClass(cls)}
                disabled={savingId === cls.id || invalid || !dirty}
                className="text-xs px-2 py-1 rounded font-medium disabled:opacity-40"
                style={{ color: '#8b4513' }}
                title={!dirty ? 'No change' : invalid ? 'Invalid amount' : 'Save'}
              >
                {savingId === cls.id ? 'Saving…' : 'Save'}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Top-level ─────────────────────────────────────────────────────────────────

export default function EntryFeesEditor({
  showId,
  initialCharges,
  initialClasses,
  judgeCount,
}: Props) {
  return (
    <section className="rounded-lg border p-4 space-y-4" style={{ borderColor: '#d4b896' }}>
      <h2 className="text-base font-semibold" style={{ color: '#2c1810' }}>Class Fees</h2>
      <ShowChargesEditor
        showId={showId}
        initialCharges={initialCharges}
        judgeCount={judgeCount}
        judgesHref={`/admin/shows/${showId}/setup/judges`}
        boxed={false}
      />
      <ClassFeesTable showId={showId} initialClasses={initialClasses} />
    </section>
  );
}
