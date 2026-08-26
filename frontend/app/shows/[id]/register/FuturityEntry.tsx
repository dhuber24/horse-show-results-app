'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * The exhibitor's own door into a show's futurities.
 *
 * Mirrors `AddClassEntry` on the same screen: one horse picker, one category
 * picker, one **Enter** button, committed on the press — not a batch form with
 * a Submit at the bottom. A futurity entry is priced per class at the category
 * rate, so the horse's futurity classes have to be entered separately in the
 * class list above; this records which program the horse is in and at what
 * rate, which is what the office cannot derive.
 */

export type FuturityTier = {
  id: string;
  name: string;
  description: string | null;
  amount_cents: number;
};

export type MyFuturityEntry = {
  id: string;
  horse_id: string | null;
  horse_name: string | null;
  fee_tier_id: string | null;
  fee_tier_name: string | null;
  is_member: boolean;
  entered_at: string;
};

export type ExhibitorFuturity = {
  id: string;
  name: string;
  description: string | null;
  entry_deadline: string | null;
  late_fee_cents: number;
  office_fee_member_cents: number;
  office_fee_nonmember_cents: number;
  is_past_deadline: boolean;
  classes: { class_id: string; class_number: string | null; class_name: string | null }[];
  fee_tiers: FuturityTier[];
  my_entries: MyFuturityEntry[];
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function formatDate(value: string | null): string {
  if (!value) return '';
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return value;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function FuturityEntry({
  showId,
  futurities,
  horses,
  signedUp,
}: {
  showId: string;
  futurities: ExhibitorFuturity[];
  horses: { id: string; name: string }[];
  signedUp: boolean;
}) {
  if (futurities.length === 0) return null;

  return (
    <section className="mt-6">
      <h3 className="text-sm font-semibold mb-2" style={{ color: '#2c1810' }}>
        Futurities
      </h3>
      <div className="space-y-3">
        {futurities.map((futurity) => (
          <FuturityCard
            key={futurity.id}
            showId={showId}
            futurity={futurity}
            horses={horses}
            signedUp={signedUp}
          />
        ))}
      </div>
    </section>
  );
}

function FuturityCard({
  showId,
  futurity,
  horses,
  signedUp,
}: {
  showId: string;
  futurity: ExhibitorFuturity;
  horses: { id: string; name: string }[];
  signedUp: boolean;
}) {
  const router = useRouter();
  const [horseId, setHorseId] = useState('');
  const [tierId, setTierId] = useState(futurity.fee_tiers[0]?.id ?? '');
  const [isMember, setIsMember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const enteredHorseIds = new Set(futurity.my_entries.map((e) => e.horse_id));
  const available = horses.filter((h) => !enteredHorseIds.has(h.id));

  async function enter() {
    setError(null);
    if (!horseId) {
      setError('Pick a horse.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/shows/${showId}/register/futurities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          futurity_id: futurity.id,
          horse_id: horseId,
          fee_tier_id: tierId || null,
          is_member: isMember,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(
          j?.detail === 'SHOW_SIGNUP_REQUIRED'
            ? 'Complete your show sign-up first.'
            : j?.detail || 'Could not enter the futurity.',
        );
        return;
      }
      setHorseId('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(entryId: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/shows/${showId}/register/futurities/${entryId}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        const j = await res.json().catch(() => null);
        setError(j?.detail || 'Could not withdraw.');
        return;
      }
      setConfirming(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="rounded-lg border p-3"
      style={{ borderColor: '#d4b896', backgroundColor: '#fff' }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium" style={{ color: '#2c1810' }}>
          {futurity.name}
        </span>
        <span className="text-xs" style={{ color: '#8b7355' }}>
          {futurity.classes.length} classes
          {futurity.entry_deadline && ` · entries close ${formatDate(futurity.entry_deadline)}`}
        </span>
      </div>

      {futurity.description && (
        <p className="text-xs mt-1" style={{ color: '#8b7355' }}>
          {futurity.description}
        </p>
      )}

      {futurity.is_past_deadline && futurity.late_fee_cents > 0 && (
        <p className="text-xs mt-1" style={{ color: '#92400e' }}>
          Entries are past the deadline — a {money(futurity.late_fee_cents)} late fee
          applies to each class entered.
        </p>
      )}

      {futurity.my_entries.length > 0 && (
        <ul className="mt-2 space-y-1">
          {futurity.my_entries.map((entry) => (
            <li
              key={entry.id}
              className="text-sm flex flex-wrap items-center gap-2"
              style={{ color: '#2c1810' }}
            >
              <span>{entry.horse_name}</span>
              {entry.fee_tier_name && (
                <span className="text-xs" style={{ color: '#8b7355' }}>
                  {entry.fee_tier_name}
                </span>
              )}
              {signedUp &&
                (confirming === entry.id ? (
                  <span className="flex items-center gap-2">
                    <button
                      onClick={() => withdraw(entry.id)}
                      disabled={busy}
                      className="text-xs text-red-600 hover:underline disabled:opacity-50"
                    >
                      Yes, withdraw
                    </button>
                    <button
                      onClick={() => setConfirming(null)}
                      disabled={busy}
                      className="text-xs hover:underline"
                      style={{ color: '#8b7355' }}
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirming(entry.id)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Withdraw
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="text-xs mt-2" style={{ color: '#922' }}>
          {error}
        </p>
      )}

      {!signedUp ? (
        <p className="text-xs mt-2" style={{ color: '#8b7355' }}>
          Complete your show sign-up above to enter the futurity.
        </p>
      ) : futurity.fee_tiers.length === 0 ? (
        <p className="text-xs mt-2" style={{ color: '#8b7355' }}>
          Entry categories haven&apos;t been published yet — check with the show office.
        </p>
      ) : available.length === 0 ? (
        <p className="text-xs mt-2" style={{ color: '#8b7355' }}>
          {horses.length === 0
            ? 'Add a horse to your profile to enter.'
            : 'All your horses are already entered.'}
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="block text-xs mb-1" style={{ color: '#8b7355' }}>
              Horse
            </span>
            <select
              value={horseId}
              onChange={(e) => setHorseId(e.target.value)}
              className="border rounded px-2 py-1.5 text-sm"
              style={{ borderColor: '#d4b896' }}
            >
              <option value="">— pick —</option>
              {available.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="block text-xs mb-1" style={{ color: '#8b7355' }}>
              Category
            </span>
            <select
              value={tierId}
              onChange={(e) => setTierId(e.target.value)}
              className="border rounded px-2 py-1.5 text-sm"
              style={{ borderColor: '#d4b896' }}
            >
              {futurity.fee_tiers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — {money(t.amount_cents)}/class
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5 pb-2 text-xs" style={{ color: '#2c1810' }}>
            <input
              type="checkbox"
              checked={isMember}
              onChange={(e) => setIsMember(e.target.checked)}
            />
            Club member
          </label>

          <button
            onClick={enter}
            disabled={busy}
            className="px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
          >
            {busy ? 'Entering…' : 'Enter futurity'}
          </button>
        </div>
      )}

      {futurity.fee_tiers.some((t) => t.description) && (
        <ul className="mt-2 text-xs space-y-0.5" style={{ color: '#8b7355' }}>
          {futurity.fee_tiers
            .filter((t) => t.description)
            .map((t) => (
              <li key={t.id}>
                <strong>{t.name}</strong> — {t.description}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
