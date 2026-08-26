'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  COLORS,
  formatCents,
  formatDate,
  type ClassItem,
  type Futurity,
} from './futurity-shared';

export default function FuturitiesManager({
  showId,
  initialFuturities,
  classes,
}: {
  showId: string;
  initialFuturities: Futurity[];
  classes: ClassItem[];
}) {
  const [futurities] = useState<Futurity[]>(initialFuturities);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-4">
      {!creating && (
        <button
          onClick={() => setCreating(true)}
          className="px-4 py-2 rounded text-sm font-medium"
          style={{ backgroundColor: COLORS.text, color: '#f5ede0' }}
        >
          + Create Futurity
        </button>
      )}

      {creating && (
        <CreateFuturityForm
          showId={showId}
          classes={classes}
          onCancel={() => setCreating(false)}
        />
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold" style={{ color: COLORS.text }}>
          Futurities
          <span className="ml-2 text-sm font-normal" style={{ color: COLORS.muted }}>
            ({futurities.length})
          </span>
        </h2>
        {futurities.length === 0 ? (
          <p className="text-sm" style={{ color: COLORS.muted }}>
            No futurities yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {futurities.map((futurity) => (
              <li key={futurity.id}>
                <Link
                  href={`/admin/shows/${showId}/futurities/${futurity.id}`}
                  className="block p-3 rounded-lg border hover:bg-gray-50 transition"
                  style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
                >
                  <div className="font-medium" style={{ color: COLORS.text }}>
                    {futurity.name}
                  </div>
                  <div className="text-xs mt-1 flex flex-wrap gap-x-3 gap-y-1" style={{ color: COLORS.muted }}>
                    <span>{futurity.classes.length} classes</span>
                    <span>· {futurity.entry_count} entered</span>
                    <span>
                      ·{' '}
                      {futurity.fee_tiers.length === 0
                        ? 'no fee tiers yet'
                        : futurity.fee_tiers
                            .map((t) => formatCents(t.amount_cents))
                            .join(' / ')}
                    </span>
                    {futurity.entry_deadline && (
                      <span>· entries close {formatDate(futurity.entry_deadline)}</span>
                    )}
                    {futurity.divisions.length > 0 && (
                      <span>
                        · {futurity.divisions.length} Hi-Point{' '}
                        {futurity.divisions.length === 1 ? 'division' : 'divisions'}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Creates the futurity with its classes and fee tiers in one post.
 *
 * Tiers are part of creation rather than a later step because a futurity with
 * no tiers cannot take an entry — the API refuses one rather than inventing a
 * price — so a create form that skipped them would produce something unusable
 * and say nothing about it. Three rows are offered by default since a tiered
 * entry fee is the normal case; blank rows are dropped.
 */
function CreateFuturityForm({
  showId,
  classes,
  onCancel,
}: {
  showId: string;
  classes: ClassItem[];
  onCancel: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [lateFee, setLateFee] = useState('');
  const [officeMember, setOfficeMember] = useState('');
  const [officeNonmember, setOfficeNonmember] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tiers, setTiers] = useState([
    { name: '', description: '', amount: '' },
    { name: '', description: '', amount: '' },
    { name: '', description: '', amount: '' },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(classId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(classId)) next.delete(classId);
      else next.add(classId);
      return next;
    });
  }

  function setTier(index: number, patch: Partial<(typeof tiers)[number]>) {
    setTiers((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }

  function toCents(input: string): number {
    const n = Number.parseFloat(input);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100);
  }

  async function submit() {
    setError(null);
    const named = tiers.filter((t) => t.name.trim() !== '');
    if (name.trim() === '') {
      setError('Give the futurity a name.');
      return;
    }
    // Caught here as well as server-side so the message names the field.
    if (lateFee.trim() !== '' && deadline === '') {
      setError(
        'A late fee needs an entry deadline — without one there is nothing for it to be late against.',
      );
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/shows/${showId}/futurities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          entry_deadline: deadline || null,
          late_fee_cents: toCents(lateFee),
          office_fee_member_cents: toCents(officeMember),
          office_fee_nonmember_cents: toCents(officeNonmember),
          class_ids: [...selected],
          fee_tiers: named.map((t, i) => ({
            name: t.name.trim(),
            description: t.description.trim() || null,
            amount_cents: toCents(t.amount),
            sort_order: i,
          })),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.detail || 'Failed to create the futurity.');
        return;
      }
      router.refresh();
      onCancel();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="p-4 rounded-lg border space-y-4"
      style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
    >
      <h3 className="font-semibold" style={{ color: COLORS.text }}>
        New futurity
      </h3>

      {error && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#c0392b', backgroundColor: '#fef0ef', color: '#922' }}
        >
          {error}
        </div>
      )}

      <label className="block">
        <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
          Name
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. North Star Futurity"
          className="w-full border rounded px-3 py-2"
          style={{ borderColor: COLORS.border }}
        />
      </label>

      <label className="block">
        <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
          Description (optional)
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full border rounded px-3 py-2"
          style={{ borderColor: COLORS.border }}
        />
      </label>

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
            placeholder="e.g. 150.00"
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
            placeholder="e.g. 10.00"
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
            placeholder="e.g. 20.00"
            className="w-full border rounded px-3 py-2"
            style={{ borderColor: COLORS.border }}
          />
        </label>
      </div>

      <div className="space-y-2">
        <span className="block text-xs" style={{ color: COLORS.muted }}>
          Entry fee by category — what one class costs. An entrant picks one.
        </span>
        {tiers.map((tier, i) => (
          <div key={i} className="grid sm:grid-cols-[1fr_2fr_7rem] gap-2">
            <input
              value={tier.name}
              onChange={(e) => setTier(i, { name: e.target.value })}
              placeholder={`Category #${i + 1}`}
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
      </div>

      <div className="space-y-1">
        <span className="block text-xs" style={{ color: COLORS.muted }}>
          Classes in this futurity ({selected.size} selected)
        </span>
        <div
          className="max-h-64 overflow-y-auto border rounded p-2 space-y-1"
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
      </div>

      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: COLORS.text, color: '#f5ede0' }}
        >
          {busy ? 'Creating…' : 'Create futurity'}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="px-4 py-2 rounded text-sm border disabled:opacity-50"
          style={{ borderColor: COLORS.border, color: COLORS.text }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
