'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ShowChargesEditor, { type ShowCharge } from '@/components/ShowChargesEditor';

/**
 * Entry Fees: what a class costs, plus the charges the show adds on top.
 *
 * The per-horse and per-judge tables that used to live here were a second
 * implementation of the same `show_fees` editing that setup Step 5 needed, in a
 * different vocabulary — and one of them wrote a `per_judge` unit that did not
 * say what it multiplied by. Both screens now render `ShowChargesEditor`, so
 * there is one shape for a charge and one place it is written.
 *
 * The office charge stays here because it is not a fee row: it is
 * `shows.office_charge_cents` with `office_charge_basis` beside it.
 */

interface ClassItem {
  id: string;
  class_number: string;
  class_name: string;
  entry_fee_cents: number;
  sort_order: number | null;
}

interface Props {
  showId: string;
  initialOfficeChargeCents: number;
  initialOfficeChargeBasis: string;
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

// ── Office charge (a column on `shows`, not a fee row) ────────────────────────

function OfficeChargeCard({
  showId,
  initialCents,
  initialBasis,
}: {
  showId: string;
  initialCents: number;
  initialBasis: string;
}) {
  const router = useRouter();

  const [draft, setDraft] = useState(dollarsFromCents(initialCents));
  const [saved, setSaved] = useState(initialCents);
  const [basis, setBasis] = useState<'per_back_number' | 'per_horse'>(
    initialBasis === 'per_horse' ? 'per_horse' : 'per_back_number',
  );
  const [savedBasis, setSavedBasis] = useState(basis);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = centsFromDollars(draft);
  const invalid = parsed === null;
  const dirty = !invalid && (parsed !== saved || basis !== savedBasis);

  const save = async () => {
    if (parsed === null) return;
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/shows/${showId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ office_charge_cents: parsed, office_charge_basis: basis }),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(parsed);
      setSavedBasis(basis);
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to save the office charge.');
    }
  };

  return (
    <section className="rounded-lg border p-4 space-y-3" style={{ borderColor: '#d4b896' }}>
      <h2 className="font-semibold" style={{ color: '#2c1810' }}>Office charge</h2>
      <p className="text-xs" style={{ color: '#8b7355' }}>
        The show&apos;s standing office / drug-testing charge, billed to everyone who
        enters a class. Anything else the show adds goes under Other fees below.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative w-24">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: '#8b7355' }}>$</span>
          <input
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Office charge amount"
            className="w-full border rounded pl-5 pr-2 py-1 text-sm"
            style={{ borderColor: invalid ? '#fca5a5' : '#d4b896' }}
          />
        </div>
        <select
          value={basis}
          onChange={(e) =>
            setBasis(e.target.value === 'per_horse' ? 'per_horse' : 'per_back_number')
          }
          aria-label="Office charge basis"
          className="border rounded px-2 py-1 text-sm"
          style={{ borderColor: '#d4b896', color: '#2c1810' }}
        >
          <option value="per_back_number">per exhibitor (back number)</option>
          <option value="per_horse">per horse</option>
        </select>
        <button
          onClick={save}
          disabled={saving || invalid || !dirty}
          className="text-xs px-2 py-1 rounded font-medium disabled:opacity-40"
          style={{ color: '#8b4513' }}
          title={!dirty ? 'No change' : invalid ? 'Invalid amount' : 'Save'}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  );
}

// ── Per-class entry fees ──────────────────────────────────────────────────────

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

  if (classes.length === 0) {
    return (
      <section className="rounded-lg border p-4" style={{ borderColor: '#d4b896' }}>
        <h2 className="font-semibold mb-1" style={{ color: '#2c1810' }}>Class entry fees</h2>
        <p className="text-sm" style={{ color: '#8b7355' }}>
          No classes yet. Add classes from the Show home page, then come back to set fees.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border p-4 space-y-3" style={{ borderColor: '#d4b896' }}>
      <h2 className="font-semibold" style={{ color: '#2c1810' }}>Class entry fees</h2>
      <p className="text-xs" style={{ color: '#8b7355' }}>
        Charged once per entry (per class per horse).
      </p>
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
    </section>
  );
}

// ── Top-level ─────────────────────────────────────────────────────────────────

export default function EntryFeesEditor({
  showId,
  initialOfficeChargeCents,
  initialOfficeChargeBasis,
  initialCharges,
  initialClasses,
  judgeCount,
}: Props) {
  return (
    <div className="space-y-4">
      <OfficeChargeCard
        showId={showId}
        initialCents={initialOfficeChargeCents}
        initialBasis={initialOfficeChargeBasis}
      />
      <ShowChargesEditor
        showId={showId}
        initialCharges={initialCharges}
        judgeCount={judgeCount}
        judgesHref={`/admin/shows/${showId}/setup/judges`}
      />
      <ClassFeesTable showId={showId} initialClasses={initialClasses} />
    </div>
  );
}
