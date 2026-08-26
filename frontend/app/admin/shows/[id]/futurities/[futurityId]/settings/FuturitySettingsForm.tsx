'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  COLORS,
  PricedClassWarning,
  formatCents,
  type ClassItem,
  type Futurity,
} from '../../futurity-shared';

type TierRow = { id: string | null; name: string; description: string; amount: string };

function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function dollarsToCents(input: string): number {
  const n = Number.parseFloat(input);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

export default function FuturitySettingsForm({
  showId,
  futurity,
  classes,
}: {
  showId: string;
  futurity: Futurity;
  classes: ClassItem[];
}) {
  const router = useRouter();
  const [name, setName] = useState(futurity.name);
  const [description, setDescription] = useState(futurity.description ?? '');
  const [deadline, setDeadline] = useState(futurity.entry_deadline ?? '');
  const [lateFee, setLateFee] = useState(
    futurity.late_fee_cents ? centsToDollars(futurity.late_fee_cents) : '',
  );
  const [officeMember, setOfficeMember] = useState(
    futurity.office_fee_member_cents ? centsToDollars(futurity.office_fee_member_cents) : '',
  );
  const [officeNonmember, setOfficeNonmember] = useState(
    futurity.office_fee_nonmember_cents
      ? centsToDollars(futurity.office_fee_nonmember_cents)
      : '',
  );
  const [tiers, setTiers] = useState<TierRow[]>(
    futurity.fee_tiers.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description ?? '',
      amount: centsToDollars(t.amount_cents),
    })),
  );
  const [selected, setSelected] = useState<Set<string>>(
    new Set(futurity.classes.map((c) => c.class_id)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function toggle(classId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(classId)) next.delete(classId);
      else next.add(classId);
      return next;
    });
  }

  function setTier(index: number, patch: Partial<TierRow>) {
    setTiers((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }

  async function save() {
    setError(null);
    setOk(null);
    if (name.trim() === '') {
      setError('Give the futurity a name.');
      return;
    }
    if (lateFee.trim() !== '' && deadline === '') {
      setError(
        'A late fee needs an entry deadline — without one there is nothing for it to be late against.',
      );
      return;
    }
    const named = tiers.filter((t) => t.name.trim() !== '');
    setBusy(true);
    try {
      const res = await fetch(`/api/shows/${showId}/futurities/${futurity.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          entry_deadline: deadline || null,
          late_fee_cents: dollarsToCents(lateFee),
          office_fee_member_cents: dollarsToCents(officeMember),
          office_fee_nonmember_cents: dollarsToCents(officeNonmember),
          class_ids: [...selected],
          fee_tiers: named.map((t, i) => ({
            name: t.name.trim(),
            description: t.description.trim() || null,
            amount_cents: dollarsToCents(t.amount),
            sort_order: i,
          })),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.detail || 'Failed to save.');
        return;
      }
      setOk('Saved.');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const selectedClasses = classes.filter((c) => selected.has(c.id));

  return (
    <div className="space-y-4">
      {error && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#c0392b', backgroundColor: '#fef0ef', color: '#922' }}
        >
          {error}
        </div>
      )}
      {ok && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#3f6b2f', backgroundColor: '#f1f7ee', color: '#3f6b2f' }}
        >
          {ok}
        </div>
      )}

      <PricedClassWarning
        showId={showId}
        classes={selectedClasses.map((c) => ({
          class_id: c.id,
          class_number: c.class_number,
          entry_fee_cents: c.entry_fee_cents,
        }))}
      />

      <section
        className="p-4 rounded-lg border space-y-3"
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
      >
        <h2 className="font-semibold" style={{ color: COLORS.text }}>
          Basics
        </h2>
        <label className="block">
          <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
            Name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border rounded px-3 py-2"
            style={{ borderColor: COLORS.border }}
          />
        </label>
        <label className="block">
          <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
            Description
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full border rounded px-3 py-2"
            style={{ borderColor: COLORS.border }}
          />
        </label>
      </section>

      <section
        className="p-4 rounded-lg border space-y-3"
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
      >
        <h2 className="font-semibold" style={{ color: COLORS.text }}>
          Deadline &amp; office fees
        </h2>
        <p className="text-xs" style={{ color: COLORS.muted }}>
          The late fee is charged per class entered, and only on enrollments taken
          after the deadline — an entry booked in April keeps its price however
          late the bill is read.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
              Entry deadline
            </span>
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="w-full border rounded px-3 py-2"
              style={{ borderColor: COLORS.border }}
            />
          </label>
          <label className="block">
            <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
              Late fee, per class ($)
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={lateFee}
              onChange={(e) => setLateFee(e.target.value)}
              className="w-full border rounded px-3 py-2"
              style={{ borderColor: COLORS.border }}
            />
          </label>
          <label className="block">
            <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
              Office fee — member ($ per horse)
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={officeMember}
              onChange={(e) => setOfficeMember(e.target.value)}
              className="w-full border rounded px-3 py-2"
              style={{ borderColor: COLORS.border }}
            />
          </label>
          <label className="block">
            <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
              Office fee — non-member ($ per horse)
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={officeNonmember}
              onChange={(e) => setOfficeNonmember(e.target.value)}
              className="w-full border rounded px-3 py-2"
              style={{ borderColor: COLORS.border }}
            />
          </label>
        </div>
      </section>

      <section
        className="p-4 rounded-lg border space-y-3"
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
      >
        <h2 className="font-semibold" style={{ color: COLORS.text }}>
          Entry fee by category
        </h2>
        <p className="text-xs" style={{ color: COLORS.muted }}>
          What one class costs. An entrant picks one category when they enter, and it
          is multiplied by however many of the futurity&rsquo;s classes their horse is
          in. Clearing a category&rsquo;s name removes it — one that still has entries
          against it cannot be removed, since it is a price somebody was quoted.
        </p>
        {tiers.map((tier, i) => (
          <div key={tier.id ?? `new-${i}`} className="grid sm:grid-cols-[1fr_2fr_7rem] gap-2">
            <input
              value={tier.name}
              onChange={(e) => setTier(i, { name: e.target.value })}
              placeholder="Category name"
              className="border rounded px-3 py-2 text-sm"
              style={{ borderColor: COLORS.border }}
            />
            <input
              value={tier.description}
              onChange={(e) => setTier(i, { description: e.target.value })}
              placeholder="who qualifies for it"
              className="border rounded px-3 py-2 text-sm"
              style={{ borderColor: COLORS.border }}
            />
            <input
              type="text"
              inputMode="decimal"
              value={tier.amount}
              onChange={(e) => setTier(i, { amount: e.target.value })}
              placeholder="$ / class"
              className="border rounded px-3 py-2 text-sm"
              style={{ borderColor: COLORS.border }}
            />
          </div>
        ))}
        <button
          onClick={() =>
            setTiers((prev) => [...prev, { id: null, name: '', description: '', amount: '' }])
          }
          className="text-sm hover:underline"
          style={{ color: COLORS.accent }}
        >
          + Add a category
        </button>
      </section>

      <section
        className="p-4 rounded-lg border space-y-2"
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
      >
        <h2 className="font-semibold" style={{ color: COLORS.text }}>
          Classes
          <span className="ml-2 text-sm font-normal" style={{ color: COLORS.muted }}>
            ({selected.size} selected)
          </span>
        </h2>
        <div
          className="max-h-80 overflow-y-auto border rounded p-2 space-y-1"
          style={{ borderColor: COLORS.border }}
        >
          {classes.length === 0 ? (
            <p className="text-sm" style={{ color: COLORS.muted }}>
              This show has no classes yet.
            </p>
          ) : (
            classes.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggle(c.id)}
                />
                <span className="font-mono text-xs">#{c.class_number}</span>
                <span style={{ color: COLORS.text }}>{c.class_name}</span>
                {c.entry_fee_cents > 0 && (
                  <span className="text-xs" style={{ color: '#922' }}>
                    (has its own {formatCents(c.entry_fee_cents)} fee)
                  </span>
                )}
              </label>
            ))
          )}
        </div>
      </section>

      <button
        onClick={save}
        disabled={busy}
        className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
        style={{ backgroundColor: COLORS.text, color: '#f5ede0' }}
      >
        {busy ? 'Saving…' : 'Save settings'}
      </button>
    </div>
  );
}
