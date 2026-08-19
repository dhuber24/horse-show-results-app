'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  formatCents,
  potMoney,
  type PotEntry,
  type RosterEntry,
  type SidePot,
} from '../../pot-shared';

/**
 * Add an exhibitor to the pot, remove one added by mistake.
 *
 * The picker lists the show's roster by name rather than asking for a back
 * number: the desk knows who is buying in, and typing a number that was never
 * assigned returned a 404 that read like the pot was broken. Whoever is already
 * in is filtered out of the options, so the same person cannot be offered twice
 * and the old 409 path is unreachable from the UI.
 *
 * There is no "paid" tick. Pot money is settled with the rest of the
 * exhibitor's bill at the end of the show, so being in the pot is what owing
 * the buy-in means — see `SidePotEntryCreate.paid` in the backend schemas.
 */
export default function SidePotEntriesPanel({
  showId,
  pot,
  initialEntries,
  roster,
}: {
  showId: string;
  pot: SidePot;
  initialEntries: PotEntry[];
  roster: RosterEntry[];
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<PotEntry[]>(initialEntries);
  const [selected, setSelected] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = pot.status === 'settled';

  // Whoever is not in the pot yet. Derived from live state, so a removal puts
  // that exhibitor back in the list immediately.
  const available = useMemo(() => {
    const taken = new Set(entries.map((e) => e.show_entry_id));
    return roster.filter((r) => !taken.has(r.show_entry_id));
  }, [roster, entries]);

  // Keeps the hub's tiles and the Standings screen honest after a change here.
  const commit = (next: PotEntry[]) => {
    setEntries(next);
    router.refresh();
  };

  const handleAdd = async () => {
    setError(null);
    if (!selected) {
      setError('Pick an exhibitor to add.');
      return;
    }
    setAdding(true);
    const res = await fetch(`/api/shows/${showId}/side-pots/${pot.id}/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ show_entry_id: selected }),
    });
    setAdding(false);
    if (res.ok) {
      const created = await res.json();
      commit([...entries, created]);
      setSelected('');
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to add this exhibitor to the pot.');
    }
  };

  const remove = async (entry: PotEntry) => {
    const res = await fetch(
      `/api/shows/${showId}/side-pots/${pot.id}/entries/${entry.id}`,
      { method: 'DELETE' },
    );
    if (res.ok || res.status === 204) {
      commit(entries.filter((e) => e.id !== entry.id));
    }
  };

  // Counts `paid`, not `entries.length`, so this can never quote a different
  // pool than the backend does. Entries created now are paid by default, so the
  // two are the same number; a pot that predates the change may hold rows the
  // old form left unticked, and those are called out below rather than being
  // quietly missing from the total.
  const paidCount = entries.filter((e) => e.paid).length;
  const legacyUnpaid = entries.length - paidCount;
  const money = potMoney(pot, paidCount);
  const rosterLabel = (r: RosterEntry) =>
    `${r.back_number != null ? `#${r.back_number}` : 'No back number'} — ${
      r.exhibitor_name ?? 'Unknown'
    }`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm" style={{ color: '#5c3d1e' }}>
          {entries.length} in the pot
        </p>
        <span className="text-sm" style={{ color: '#5c3d1e' }}>
          Buy-ins: {formatCents(money.buyInsCents)} · Payout pool:{' '}
          {formatCents(money.payoutPoolCents)}
        </span>
      </div>

      {disabled ? (
        <div
          className="rounded border px-4 py-3 text-sm"
          style={{ backgroundColor: '#faf7f2', borderColor: '#d4b896', color: '#5d4a37' }}
        >
          This pot is settled. Its payouts were computed from this list, so it is locked.
        </div>
      ) : (
        <div
          className="flex flex-wrap gap-2 items-end p-3 rounded-lg border"
          style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
        >
          <div className="flex-1 min-w-[16rem]">
            <label
              htmlFor="pot-exhibitor"
              className="text-xs block mb-1"
              style={{ color: '#8b7355' }}
            >
              Exhibitor
            </label>
            <select
              id="pot-exhibitor"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={available.length === 0}
              className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-50"
            >
              <option value="">
                {available.length === 0
                  ? 'Everyone on the roster is already in'
                  : 'Select an exhibitor…'}
              </option>
              {available.map((r) => (
                <option key={r.show_entry_id} value={r.show_entry_id}>
                  {rosterLabel(r)}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleAdd}
            disabled={adding || !selected}
            title={!selected ? 'Pick an exhibitor first' : undefined}
            className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
          >
            {adding ? 'Adding…' : 'Add to pot'}
          </button>
          {error && <p className="text-red-600 text-sm w-full">{error}</p>}
          {roster.length === 0 && (
            <p className="text-xs w-full" style={{ color: '#8b7355' }}>
              Nobody is on this show&rsquo;s roster yet — exhibitors appear here once they
              have signed up or been entered by the office.
            </p>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <p className="text-sm" style={{ color: '#8b7355' }}>
          Nobody has entered this pot yet.
        </p>
      ) : (
        <ul className="space-y-1">
          {entries
            .slice()
            .sort((a, b) => (a.back_number ?? 0) - (b.back_number ?? 0))
            .map((entry) => (
              <li
                key={entry.id}
                className="flex items-center gap-3 px-3 py-2 rounded border text-sm"
                style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0' }}
              >
                <span
                  className="text-xs font-mono px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: '#f0e8d8', color: '#8b4513' }}
                  title={
                    entry.back_number == null
                      ? 'No back number assigned yet — it fills in here once it is'
                      : undefined
                  }
                >
                  #{entry.back_number ?? '—'}
                </span>
                <span style={{ color: '#2c1810' }}>
                  {entry.exhibitor_name ?? 'Unknown'}
                </span>
                {!disabled && (
                  <button
                    onClick={() => remove(entry)}
                    className="ml-auto text-xs text-red-600 hover:text-red-800"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
        </ul>
      )}

      <p className="text-xs" style={{ color: '#8b7355' }}>
        Buy-ins are owed by everyone in the pot and settle with the exhibitor&rsquo;s bill at
        the end of the show, so the pool above counts every entry.
        {legacyUnpaid > 0 && (
          <>
            {' '}
            {legacyUnpaid} {legacyUnpaid === 1 ? 'entry was' : 'entries were'} added before
            that and {legacyUnpaid === 1 ? 'is' : 'are'} still marked unpaid, so{' '}
            {legacyUnpaid === 1 ? 'it is' : 'they are'} not in the pool — remove and re-add
            to count {legacyUnpaid === 1 ? 'it' : 'them'}.
          </>
        )}
      </p>
    </div>
  );
}
