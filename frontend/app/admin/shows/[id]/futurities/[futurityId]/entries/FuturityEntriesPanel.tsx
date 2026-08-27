'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  COLORS,
  formatCents,
  formatDate,
  type Futurity,
  type FuturityEntry,
} from '../../futurity-shared';

interface RosterHorse {
  horse_id: string;
  horse_name: string;
  already_entered: boolean;
}

interface RosterRow {
  show_entry_id: string;
  back_number: number | null;
  exhibitor_name: string | null;
  horses: RosterHorse[];
}

export default function FuturityEntriesPanel({
  showId,
  futurity,
  initialEntries,
  roster,
}: {
  showId: string;
  futurity: Futurity;
  initialEntries: FuturityEntry[];
  roster: RosterRow[];
}) {
  const router = useRouter();
  const [entries] = useState<FuturityEntry[]>(initialEntries);
  const [adding, setAdding] = useState(false);

  const total = useMemo(
    () => entries.reduce((sum, e) => sum + e.charge_cents, 0),
    [entries],
  );

  return (
    <div className="space-y-4">
      {futurity.fee_tiers.length === 0 ? (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#c0392b', backgroundColor: '#fef0ef', color: '#922' }}
        >
          <strong>No entry fee categories set up.</strong> A futurity prices each
          class by the entrant&rsquo;s category, so entries are refused until at
          least one exists. Add one in Settings.
        </div>
      ) : !adding ? (
        <button
          onClick={() => setAdding(true)}
          className="px-4 py-2 rounded text-sm font-medium"
          style={{ backgroundColor: COLORS.text, color: '#f5ede0' }}
        >
          + Enter a horse
        </button>
      ) : (
        <AddEntryForm
          showId={showId}
          futurity={futurity}
          roster={roster}
          onDone={() => setAdding(false)}
        />
      )}

      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold" style={{ color: COLORS.text }}>
            Entered
            <span className="ml-2 text-sm font-normal" style={{ color: COLORS.muted }}>
              ({entries.length})
            </span>
          </h2>
          <span className="text-sm tabular-nums" style={{ color: COLORS.muted }}>
            {formatCents(total)} billed
          </span>
        </div>

        {entries.length === 0 ? (
          <p className="text-sm" style={{ color: COLORS.muted }}>
            Nobody entered yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: COLORS.muted }}>
                  <th className="text-left font-medium py-1 pr-3">#</th>
                  <th className="text-left font-medium py-1 pr-3">Horse</th>
                  <th className="text-left font-medium py-1 pr-3">Exhibitor</th>
                  <th className="text-left font-medium py-1 pr-3">Category</th>
                  <th className="text-right font-medium py-1 pr-3">Classes</th>
                  <th className="text-left font-medium py-1 pr-3">Entered</th>
                  <th className="text-right font-medium py-1 pr-3">Charge</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    showId={showId}
                    futurity={futurity}
                    entry={entry}
                    onChanged={() => router.refresh()}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function EntryRow({
  showId,
  futurity,
  entry,
  onChanged,
}: {
  showId: string;
  futurity: Futurity;
  entry: FuturityEntry;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/shows/${showId}/futurities/${futurity.id}/entries/${entry.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.detail || 'Failed to update.');
        return;
      }
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/shows/${showId}/futurities/${futurity.id}/entries/${entry.id}`,
        { method: 'DELETE' },
      );
      if (!res.ok && res.status !== 204) {
        const j = await res.json().catch(() => null);
        setError(j?.detail || 'Failed to remove.');
        return;
      }
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <tr style={{ color: COLORS.text }} className="border-t" >
        <td className="py-2 pr-3 tabular-nums">{entry.back_number ?? '—'}</td>
        <td className="py-2 pr-3">
          {entry.horse_name ?? '—'}
          {/* The entry form asks for foaling date, sire and dam, and a futurity
              judged in age divisions cannot do without them. Flagged rather than
              refused: the office is taking a paper form across a counter, and
              blocking the entry would not produce the sire's name. */}
          {entry.missing_horse_details.length > 0 && (
            <span className="block text-xs" style={{ color: '#922' }}>
              missing {entry.missing_horse_details.join(', ')}
            </span>
          )}
        </td>
        <td className="py-2 pr-3">
          {entry.exhibitor_name ?? '—'}
          {entry.shown_by_name && (
            <span className="block text-xs" style={{ color: COLORS.muted }}>
              shown by {entry.shown_by_name}
            </span>
          )}
        </td>
        <td className="py-2 pr-3">
          <select
            value={entry.fee_tier_id ?? ''}
            disabled={busy}
            onChange={(e) => patch({ fee_tier_id: e.target.value || null })}
            className="border rounded px-2 py-1 text-xs"
            style={{ borderColor: COLORS.border }}
          >
            <option value="">— none —</option>
            {futurity.fee_tiers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({formatCents(t.amount_cents)})
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 mt-1 text-xs" style={{ color: COLORS.muted }}>
            <input
              type="checkbox"
              checked={entry.is_member}
              disabled={busy}
              onChange={(e) => patch({ is_member: e.target.checked })}
            />
            member
          </label>
          {futurity.membership_options.length > 0 && (
            <select
              value={entry.membership_option_id ?? ''}
              disabled={busy}
              onChange={(e) =>
                patch({ membership_option_id: e.target.value || null })
              }
              className="border rounded px-2 py-1 mt-1 text-xs"
              style={{ borderColor: COLORS.border }}
              title="A club membership bought with this entry, charged once. Separate from the member office fee above, which follows a card they already hold."
            >
              <option value="">no membership bought</option>
              {futurity.membership_options.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({formatCents(m.amount_cents)})
                </option>
              ))}
            </select>
          )}
        </td>
        <td className="py-2 pr-3 text-right tabular-nums">{entry.entered_class_count}</td>
        <td className="py-2 pr-3">
          {formatDate(entry.entered_at)}
          {entry.is_late && (
            <span className="ml-1 text-xs" style={{ color: '#922' }}>
              late
            </span>
          )}
        </td>
        <td className="py-2 pr-3 text-right tabular-nums">
          {formatCents(entry.charge_cents)}
        </td>
        <td className="py-2 text-right">
          {confirming ? (
            <span className="flex items-center gap-2 justify-end">
              <button
                onClick={remove}
                disabled={busy}
                className="text-xs text-red-600 hover:underline disabled:opacity-50"
              >
                {busy ? '…' : 'Yes, remove'}
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="text-xs hover:underline"
                style={{ color: COLORS.muted }}
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="text-xs text-red-600 hover:underline"
            >
              Remove
            </button>
          )}
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={8} className="pb-2 text-xs" style={{ color: '#922' }}>
            {error}
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Enroll one horse. The exhibitor picker drives the horse picker, so the only
 * horses on offer are that exhibitor's — and one already enrolled is dropped,
 * since the backend enforces one enrollment per horse anyway.
 */
function AddEntryForm({
  showId,
  futurity,
  roster,
  onDone,
}: {
  showId: string;
  futurity: Futurity;
  roster: RosterRow[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [showEntryId, setShowEntryId] = useState('');
  const [horseId, setHorseId] = useState('');
  const [tierId, setTierId] = useState(futurity.fee_tiers[0]?.id ?? '');
  const [isMember, setIsMember] = useState(false);
  const [membershipId, setMembershipId] = useState('');
  const [exhibitorName, setExhibitorName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const person = roster.find((r) => r.show_entry_id === showEntryId);
  const horses = (person?.horses ?? []).filter((h) => !h.already_entered);

  async function submit() {
    setError(null);
    if (!showEntryId || !horseId) {
      setError('Pick an exhibitor and a horse.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/shows/${showId}/futurities/${futurity.id}/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          show_entry_id: showEntryId,
          horse_id: horseId,
          fee_tier_id: tierId || null,
          membership_option_id: membershipId || null,
          is_member: isMember,
          shown_by_name: exhibitorName.trim() || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.detail || 'Failed to enter.');
        return;
      }
      // Kept open so a queue of entries goes in one after another, like the
      // desk's add-entry form. The category, membership and member flag stay as
      // they are: a queue at the counter is usually the same answers twice.
      setHorseId('');
      setExhibitorName('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="p-4 rounded-lg border space-y-3"
      style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
    >
      <h3 className="font-semibold" style={{ color: COLORS.text }}>
        Enter a horse
      </h3>

      {error && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#c0392b', backgroundColor: '#fef0ef', color: '#922' }}
        >
          {error}
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
            Exhibitor
          </span>
          <select
            value={showEntryId}
            onChange={(e) => {
              setShowEntryId(e.target.value);
              setHorseId('');
            }}
            className="w-full border rounded px-3 py-2 text-sm"
            style={{ borderColor: COLORS.border }}
          >
            <option value="">— pick —</option>
            {roster.map((r) => (
              <option key={r.show_entry_id} value={r.show_entry_id}>
                {r.back_number != null ? `#${r.back_number} ` : ''}
                {r.exhibitor_name ?? 'Unnamed'}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
            Horse
          </span>
          <select
            value={horseId}
            onChange={(e) => setHorseId(e.target.value)}
            disabled={!showEntryId}
            className="w-full border rounded px-3 py-2 text-sm disabled:opacity-50"
            style={{ borderColor: COLORS.border }}
          >
            <option value="">— pick —</option>
            {horses.map((h) => (
              <option key={h.horse_id} value={h.horse_id}>
                {h.horse_name}
              </option>
            ))}
          </select>
          {showEntryId && horses.length === 0 && (
            <span className="block text-xs mt-1" style={{ color: COLORS.muted }}>
              No horses of theirs are entered at this show yet — add their class
              entries first.
            </span>
          )}
        </label>

        <label className="block">
          <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
            Category
          </span>
          <select
            value={tierId}
            onChange={(e) => setTierId(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
            style={{ borderColor: COLORS.border }}
          >
            {futurity.fee_tiers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — {formatCents(t.amount_cents)}/class
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-end gap-2 pb-2 text-sm" style={{ color: COLORS.text }}>
          <input
            type="checkbox"
            checked={isMember}
            onChange={(e) => setIsMember(e.target.checked)}
          />
          Club member ({formatCents(futurity.office_fee_member_cents)} office fee
          instead of {formatCents(futurity.office_fee_nonmember_cents)})
        </label>

        {futurity.membership_options.length > 0 && (
          <label className="block">
            <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
              Buying a membership?
            </span>
            <select
              value={membershipId}
              onChange={(e) => setMembershipId(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{ borderColor: COLORS.border }}
            >
              <option value="">— no —</option>
              {futurity.membership_options.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — {formatCents(m.amount_cents)}
                </option>
              ))}
            </select>
            <span className="block text-xs mt-1" style={{ color: COLORS.muted }}>
              Charged once, on top of the office fee. Somebody joining today is
              not yet a member for the fee above.
            </span>
          </label>
        )}

        <label className="block">
          <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
            Exhibitor, if not the owner
          </span>
          <input
            value={exhibitorName}
            onChange={(e) => setExhibitorName(e.target.value)}
            placeholder="who is showing the horse"
            className="w-full border rounded px-3 py-2 text-sm"
            style={{ borderColor: COLORS.border }}
          />
        </label>
      </div>

      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: COLORS.text, color: '#f5ede0' }}
        >
          {busy ? 'Entering…' : 'Enter'}
        </button>
        <button
          onClick={onDone}
          disabled={busy}
          className="px-4 py-2 rounded text-sm border disabled:opacity-50"
          style={{ borderColor: COLORS.border, color: COLORS.text }}
        >
          Done
        </button>
      </div>
    </div>
  );
}
