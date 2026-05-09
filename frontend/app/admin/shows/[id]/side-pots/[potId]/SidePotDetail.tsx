'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type ScoreType = 'placement' | 'pattern' | 'time';
type ScoringMethod = 'sum_placings' | 'sum_scores';
type EligibilityRule = 'all_classes' | 'any_class';
type Status = 'open' | 'closed' | 'settled';

interface ClassItem {
  id: string;
  class_number: string;
  class_name: string;
  class_date: string;
  score_type: ScoreType;
}

interface PotClass {
  class_id: string;
  class_number: string;
  class_name: string;
  score_type: ScoreType;
}

interface SidePot {
  id: string;
  show_id: string;
  name: string;
  description: string | null;
  entry_fee_cents: number;
  payback_percent: number;
  scoring_method: ScoringMethod;
  eligibility_rule: EligibilityRule;
  payout_schedule: Record<string, number[]>;
  status: Status;
  settled_at: string | null;
  classes: PotClass[];
  entry_count: number;
  paid_count: number;
}

interface PotEntry {
  id: string;
  side_pot_id: string;
  show_entry_id: string;
  back_number: number | null;
  exhibitor_name: string | null;
  paid: boolean;
  created_at: string;
}

interface Standing {
  show_entry_id: string;
  back_number: number | null;
  exhibitor_name: string | null;
  aggregate_value: number;
  place: number | null;
  is_eligible: boolean;
  missing_class_ids: string[];
  paid: boolean;
}

interface Standings {
  side_pot_id: string;
  status: Status;
  scoring_method: ScoringMethod;
  eligibility_rule: EligibilityRule;
  total_pool_cents: number;
  payout_pool_cents: number;
  standings: Standing[];
  projected_payouts: Record<string, number>;
}

interface Payout {
  id: string;
  side_pot_id: string;
  show_entry_id: string;
  back_number: number | null;
  exhibitor_name: string | null;
  place: number;
  payout_cents: number;
  aggregate_value: number;
  tiebreaker_notes: string | null;
}

const STATUS_BADGE: Record<Status, { label: string; bg: string; fg: string }> = {
  open: { label: 'Open', bg: '#dcebd5', fg: '#3f6b2f' },
  closed: { label: 'Closed', bg: '#f0e8d8', fg: '#8b4513' },
  settled: { label: 'Settled', bg: '#d4d4d4', fg: '#404040' },
};

const formatCents = (cents: number) =>
  `$${(cents / 100).toFixed(2)}`;

export default function SidePotDetail({
  showId,
  initialPot,
  initialEntries,
  initialStandings,
  initialPayouts,
  classes,
}: {
  showId: string;
  initialPot: SidePot;
  initialEntries: PotEntry[];
  initialStandings: Standings | null;
  initialPayouts: Payout[];
  classes: ClassItem[];
}) {
  const router = useRouter();
  const [pot, setPot] = useState<SidePot>(initialPot);
  const [entries, setEntries] = useState<PotEntry[]>(initialEntries);
  const [standings, setStandings] = useState<Standings | null>(initialStandings);
  const [payouts, setPayouts] = useState<Payout[]>(initialPayouts);

  const isSettled = pot.status === 'settled';

  const refreshStandings = async () => {
    const res = await fetch(
      `/api/shows/${showId}/side-pots/${pot.id}/standings`,
    );
    if (res.ok) setStandings(await res.json());
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>
            {pot.name}
          </h1>
          {pot.description && (
            <p className="text-sm mt-1" style={{ color: '#5c3d1e' }}>
              {pot.description}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <span
              className="text-xs px-2 py-0.5 rounded-full"
              style={{
                backgroundColor: STATUS_BADGE[pot.status].bg,
                color: STATUS_BADGE[pot.status].fg,
              }}
            >
              {STATUS_BADGE[pot.status].label}
            </span>
            {pot.settled_at && (
              <span className="text-xs" style={{ color: '#8b7355' }}>
                Settled {new Date(pot.settled_at).toLocaleString()}
              </span>
            )}
          </div>
        </div>
      </div>

      <SettingsSection
        showId={showId}
        pot={pot}
        classes={classes}
        onSaved={(updated) => {
          setPot(updated);
          router.refresh();
        }}
        disabled={isSettled}
      />

      <EntriesSection
        showId={showId}
        pot={pot}
        entries={entries}
        onChanged={(next) => {
          setEntries(next);
          refreshStandings();
        }}
        disabled={isSettled}
      />

      <StandingsSection
        pot={pot}
        standings={standings}
        onRefresh={refreshStandings}
      />

      {!isSettled && (
        <SettleSection
          showId={showId}
          pot={pot}
          standings={standings}
          onSettled={(settledPot, settledPayouts) => {
            setPot(settledPot);
            setPayouts(settledPayouts);
            router.refresh();
          }}
        />
      )}

      {payouts.length > 0 && (
        <PayoutsSection payouts={payouts} />
      )}

      {!isSettled && (
        <DeletePotSection showId={showId} pot={pot} />
      )}
    </div>
  );
}

// ── Settings ──────────────────────────────────────────────────────────────────

function SettingsSection({
  showId,
  pot,
  classes,
  onSaved,
  disabled,
}: {
  showId: string;
  pot: SidePot;
  classes: ClassItem[];
  onSaved: (pot: SidePot) => void;
  disabled: boolean;
}) {
  const [name, setName] = useState(pot.name);
  const [description, setDescription] = useState(pot.description ?? '');
  const [feeDollars, setFeeDollars] = useState(
    (pot.entry_fee_cents / 100).toFixed(2),
  );
  const [paybackPercent, setPaybackPercent] = useState(
    String(pot.payback_percent),
  );
  const [scoringMethod, setScoringMethod] = useState<ScoringMethod>(
    pot.scoring_method,
  );
  const [eligibilityRule, setEligibilityRule] = useState<EligibilityRule>(
    pot.eligibility_rule,
  );
  const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(
    new Set(pot.classes.map((c) => c.class_id)),
  );
  const [classFilter, setClassFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligibleClasses = useMemo(() => {
    if (scoringMethod === 'sum_scores') {
      return classes.filter(
        (c) => c.score_type === 'pattern' || c.score_type === 'time',
      );
    }
    return classes;
  }, [classes, scoringMethod]);

  const filtered = useMemo(() => {
    const q = classFilter.toLowerCase().trim();
    if (!q) return eligibleClasses;
    return eligibleClasses.filter(
      (c) =>
        c.class_number.toLowerCase().includes(q) ||
        c.class_name.toLowerCase().includes(q),
    );
  }, [eligibleClasses, classFilter]);

  const isDirty =
    name !== pot.name ||
    (description || '') !== (pot.description ?? '') ||
    Math.round(parseFloat(feeDollars) * 100) !== pot.entry_fee_cents ||
    parseInt(paybackPercent, 10) !== pot.payback_percent ||
    scoringMethod !== pot.scoring_method ||
    eligibilityRule !== pot.eligibility_rule ||
    selectedClassIds.size !== pot.classes.length ||
    pot.classes.some((c) => !selectedClassIds.has(c.class_id));

  const handleSave = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    if (selectedClassIds.size === 0) {
      setError('Select at least one class.');
      return;
    }
    const feeCents = Math.round(parseFloat(feeDollars || '0') * 100);
    const payback = parseInt(paybackPercent, 10);
    if (Number.isNaN(feeCents) || feeCents < 0) {
      setError('Entry fee must be a non-negative number.');
      return;
    }
    if (Number.isNaN(payback) || payback < 0 || payback > 100) {
      setError('Payback percent must be between 0 and 100.');
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/shows/${showId}/side-pots/${pot.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        description: description.trim() || null,
        entry_fee_cents: feeCents,
        payback_percent: payback,
        scoring_method: scoringMethod,
        eligibility_rule: eligibilityRule,
        class_ids: Array.from(selectedClassIds),
      }),
    });
    setSaving(false);
    if (res.ok) {
      onSaved(await res.json());
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to save.');
    }
  };

  const groupedFiltered = useMemo(() => {
    const map = new Map<string, ClassItem[]>();
    for (const c of filtered) {
      const arr = map.get(c.class_date) ?? [];
      arr.push(c);
      map.set(c.class_date, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const toggleClass = (id: string) => {
    setSelectedClassIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <section
      className="border rounded-lg p-4 space-y-3"
      style={{ borderColor: '#d4b896' }}
    >
      <h2 className="font-semibold" style={{ color: '#2c1810' }}>
        Settings
      </h2>
      <fieldset disabled={disabled} className="space-y-3">
        <div>
          <label className="text-sm text-gray-500 block mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border rounded px-3 py-2 disabled:bg-gray-50"
          />
        </div>
        <div>
          <label className="text-sm text-gray-500 block mb-1">
            Description
          </label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border rounded px-3 py-2 disabled:bg-gray-50"
          />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-sm text-gray-500 block mb-1">
              Entry fee ($)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={feeDollars}
              onChange={(e) => setFeeDollars(e.target.value)}
              className="w-full border rounded px-3 py-2 disabled:bg-gray-50"
            />
          </div>
          <div className="flex-1">
            <label className="text-sm text-gray-500 block mb-1">
              Payback %
            </label>
            <input
              type="number"
              min="0"
              max="100"
              value={paybackPercent}
              onChange={(e) => setPaybackPercent(e.target.value)}
              className="w-full border rounded px-3 py-2 disabled:bg-gray-50"
            />
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-sm text-gray-500 block mb-1">Scoring</label>
            <select
              value={scoringMethod}
              onChange={(e) =>
                setScoringMethod(e.target.value as ScoringMethod)
              }
              className="w-full border rounded px-3 py-2 disabled:bg-gray-50"
            >
              <option value="sum_placings">Sum of placings (lowest wins)</option>
              <option value="sum_scores">Sum of scores (highest wins)</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="text-sm text-gray-500 block mb-1">
              Eligibility
            </label>
            <select
              value={eligibilityRule}
              onChange={(e) =>
                setEligibilityRule(e.target.value as EligibilityRule)
              }
              className="w-full border rounded px-3 py-2 disabled:bg-gray-50"
            >
              <option value="all_classes">
                Must place in every bundled class
              </option>
              <option value="any_class">
                Allow missing classes (last + 1)
              </option>
            </select>
          </div>
        </div>

        <div className="space-y-2 pt-2 border-t" style={{ borderColor: '#e8d5b7' }}>
          <div className="flex items-baseline justify-between gap-2">
            <label
              className="text-sm font-medium"
              style={{ color: '#2c1810' }}
            >
              Bundled classes ({selectedClassIds.size} selected)
            </label>
            <input
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              placeholder="Filter"
              className="text-sm border rounded px-2 py-1 disabled:bg-gray-50"
            />
          </div>
          {scoringMethod === 'sum_scores' && (
            <p className="text-xs" style={{ color: '#8b7355' }}>
              Showing only pattern and timed classes.
            </p>
          )}
          <div
            className="border rounded overflow-y-auto"
            style={{ maxHeight: '280px', borderColor: '#e8d5b7' }}
          >
            {filtered.length === 0 ? (
              <p
                className="p-3 text-sm"
                style={{ color: '#8b7355' }}
              >
                No matching classes.
              </p>
            ) : (
              <div>
                {groupedFiltered.map(([date, dayClasses]) => (
                  <div key={date}>
                    <div
                      className="px-3 py-1.5 text-xs font-medium sticky top-0"
                      style={{ backgroundColor: '#faf6f0', color: '#5c3d1e' }}
                    >
                      {date}
                    </div>
                    {dayClasses.map((c) => (
                      <label
                        key={c.id}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm border-t cursor-pointer hover:bg-gray-50"
                        style={{ borderColor: '#f0e6d2' }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedClassIds.has(c.id)}
                          onChange={() => toggleClass(c.id)}
                        />
                        <span
                          className="text-xs font-mono px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: '#f0e8d8',
                            color: '#8b4513',
                          }}
                        >
                          #{c.class_number}
                        </span>
                        <span style={{ color: '#2c1810' }}>{c.class_name}</span>
                        {c.score_type !== 'placement' && (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded ml-auto"
                            style={{
                              backgroundColor: '#dcebd5',
                              color: '#3f6b2f',
                            }}
                          >
                            {c.score_type === 'pattern' ? 'Pattern' : 'Timed'}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}
        {!disabled && (
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !isDirty}
              title={!isDirty ? 'No changes to save' : undefined}
              className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
            >
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        )}
      </fieldset>
      {disabled && (
        <p className="text-xs italic" style={{ color: '#8b7355' }}>
          Settled — settings are locked.
        </p>
      )}
    </section>
  );
}

// ── Opt-ins ───────────────────────────────────────────────────────────────────

function EntriesSection({
  showId,
  pot,
  entries,
  onChanged,
  disabled,
}: {
  showId: string;
  pot: SidePot;
  entries: PotEntry[];
  onChanged: (entries: PotEntry[]) => void;
  disabled: boolean;
}) {
  const [backInput, setBackInput] = useState('');
  const [paid, setPaid] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async () => {
    setError(null);
    const num = parseInt(backInput, 10);
    if (Number.isNaN(num) || num <= 0) {
      setError('Enter a valid back number.');
      return;
    }
    setAdding(true);
    const res = await fetch(
      `/api/shows/${showId}/side-pots/${pot.id}/entries`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ back_number: num, paid }),
      },
    );
    setAdding(false);
    if (res.ok) {
      const created = await res.json();
      onChanged([...entries, created]);
      setBackInput('');
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to add opt-in.');
    }
  };

  const togglePaid = async (entry: PotEntry) => {
    const res = await fetch(
      `/api/shows/${showId}/side-pots/${pot.id}/entries/${entry.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paid: !entry.paid }),
      },
    );
    if (res.ok) {
      const updated = await res.json();
      onChanged(entries.map((e) => (e.id === entry.id ? updated : e)));
    }
  };

  const remove = async (entry: PotEntry) => {
    const res = await fetch(
      `/api/shows/${showId}/side-pots/${pot.id}/entries/${entry.id}`,
      { method: 'DELETE' },
    );
    if (res.ok || res.status === 204) {
      onChanged(entries.filter((e) => e.id !== entry.id));
    }
  };

  const paidCount = entries.filter((e) => e.paid).length;
  const totalPoolCents = pot.entry_fee_cents * paidCount;
  const payoutPoolCents = Math.floor(
    (totalPoolCents * pot.payback_percent) / 100,
  );

  return (
    <section
      className="border rounded-lg p-4 space-y-3"
      style={{ borderColor: '#d4b896' }}
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold" style={{ color: '#2c1810' }}>
          Opt-ins ({entries.length})
        </h2>
        <span className="text-sm" style={{ color: '#5c3d1e' }}>
          Pool: {formatCents(totalPoolCents)} · Payout pool:{' '}
          {formatCents(payoutPoolCents)}
        </span>
      </div>

      {!disabled && (
        <div className="flex flex-wrap gap-2 items-end pt-1">
          <div>
            <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>
              Back number
            </label>
            <input
              type="number"
              min="1"
              value={backInput}
              onChange={(e) => setBackInput(e.target.value)}
              placeholder="e.g. 42"
              className="w-32 border rounded px-3 py-2 text-sm"
            />
          </div>
          <label className="flex items-center gap-1 text-sm pb-2">
            <input
              type="checkbox"
              checked={paid}
              onChange={(e) => setPaid(e.target.checked)}
            />
            <span style={{ color: '#5c3d1e' }}>Paid</span>
          </label>
          <button
            onClick={handleAdd}
            disabled={adding}
            className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
          >
            {adding ? 'Adding…' : 'Add opt-in'}
          </button>
          {error && <p className="text-red-600 text-sm w-full">{error}</p>}
        </div>
      )}

      {entries.length === 0 ? (
        <p className="text-sm" style={{ color: '#8b7355' }}>
          No opt-ins yet.
        </p>
      ) : (
        <ul className="space-y-1">
          {entries
            .slice()
            .sort(
              (a, b) =>
                (a.back_number ?? 0) - (b.back_number ?? 0),
            )
            .map((entry) => (
              <li
                key={entry.id}
                className="flex items-center gap-3 px-3 py-2 rounded border text-sm"
                style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0' }}
              >
                <span
                  className="text-xs font-mono px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: '#f0e8d8', color: '#8b4513' }}
                >
                  #{entry.back_number ?? '—'}
                </span>
                <span style={{ color: '#2c1810' }}>
                  {entry.exhibitor_name ?? 'Unknown'}
                </span>
                <label className="ml-auto flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={entry.paid}
                    onChange={() => togglePaid(entry)}
                    disabled={disabled}
                  />
                  <span style={{ color: '#5c3d1e' }}>Paid</span>
                </label>
                {!disabled && (
                  <button
                    onClick={() => remove(entry)}
                    className="text-xs text-red-600 hover:text-red-800"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}

// ── Standings ─────────────────────────────────────────────────────────────────

function StandingsSection({
  pot,
  standings,
  onRefresh,
}: {
  pot: SidePot;
  standings: Standings | null;
  onRefresh: () => void;
}) {
  if (!standings) {
    return (
      <section
        className="border rounded-lg p-4"
        style={{ borderColor: '#d4b896' }}
      >
        <h2 className="font-semibold" style={{ color: '#2c1810' }}>
          Standings
        </h2>
        <p className="text-sm mt-2" style={{ color: '#8b7355' }}>
          Standings will appear once classes have results.
        </p>
      </section>
    );
  }

  return (
    <section
      className="border rounded-lg p-4 space-y-3"
      style={{ borderColor: '#d4b896' }}
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold" style={{ color: '#2c1810' }}>
          Standings (live)
        </h2>
        <button
          onClick={onRefresh}
          className="text-xs hover:underline"
          style={{ color: '#8b4513' }}
        >
          Refresh
        </button>
      </div>
      <p className="text-xs" style={{ color: '#8b7355' }}>
        {pot.scoring_method === 'sum_scores'
          ? 'Highest sum of raw judge scores wins.'
          : 'Lowest sum of placings wins.'}{' '}
        {pot.eligibility_rule === 'all_classes'
          ? 'Entries must place in every bundled class.'
          : 'Missing classes count as last + 1.'}
      </p>
      {standings.standings.length === 0 ? (
        <p className="text-sm" style={{ color: '#8b7355' }}>
          No opt-ins to rank.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: '#e8d5b7' }}>
              <th className="text-left py-1">Place</th>
              <th className="text-left py-1">Back #</th>
              <th className="text-left py-1">Exhibitor</th>
              <th className="text-right py-1">
                {pot.scoring_method === 'sum_scores' ? 'Score sum' : 'Place sum'}
              </th>
              <th className="text-right py-1">Projected</th>
            </tr>
          </thead>
          <tbody>
            {standings.standings.map((s) => {
              const key =
                s.back_number != null ? String(s.back_number) : s.show_entry_id;
              const projected = standings.projected_payouts[key] ?? 0;
              return (
                <tr
                  key={s.show_entry_id}
                  className="border-b"
                  style={{
                    borderColor: '#f0e6d2',
                    color: s.is_eligible ? '#2c1810' : '#999',
                  }}
                >
                  <td className="py-1">
                    {s.is_eligible ? s.place ?? '—' : 'DQ'}
                  </td>
                  <td className="py-1 font-mono">
                    #{s.back_number ?? '—'}
                  </td>
                  <td className="py-1">
                    {s.exhibitor_name ?? '—'}
                    {!s.is_eligible && s.missing_class_ids.length > 0 && (
                      <span
                        className="text-xs ml-2"
                        style={{ color: '#b45309' }}
                      >
                        Missing {s.missing_class_ids.length} class
                        {s.missing_class_ids.length === 1 ? '' : 'es'}
                      </span>
                    )}
                    {!s.paid && (
                      <span
                        className="text-xs ml-2"
                        style={{ color: '#b45309' }}
                      >
                        Unpaid
                      </span>
                    )}
                  </td>
                  <td className="py-1 text-right">
                    {s.aggregate_value.toFixed(
                      pot.scoring_method === 'sum_scores' ? 2 : 0,
                    )}
                  </td>
                  <td className="py-1 text-right">
                    {projected ? formatCents(projected) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ── Settle ────────────────────────────────────────────────────────────────────

function SettleSection({
  showId,
  pot,
  standings,
  onSettled,
}: {
  showId: string;
  pot: SidePot;
  standings: Standings | null;
  onSettled: (pot: SidePot, payouts: Payout[]) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSettle = async () => {
    setError(null);
    setWorking(true);
    const res = await fetch(
      `/api/shows/${showId}/side-pots/${pot.id}/settle`,
      { method: 'POST' },
    );
    setWorking(false);
    if (res.ok) {
      const newPayouts: Payout[] = await res.json();
      onSettled({ ...pot, status: 'settled', settled_at: new Date().toISOString() }, newPayouts);
      setConfirming(false);
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to settle pot.');
    }
  };

  const paidCount = standings ? standings.standings.filter((s) => s.paid).length : 0;
  const eligibleCount = standings
    ? standings.standings.filter((s) => s.is_eligible).length
    : 0;

  return (
    <section
      className="border rounded-lg p-4 space-y-2"
      style={{ borderColor: '#d4b896', backgroundColor: '#fffaf0' }}
    >
      <h2 className="font-semibold" style={{ color: '#2c1810' }}>
        Settle pot
      </h2>
      <p className="text-sm" style={{ color: '#5c3d1e' }}>
        Freezes the rankings, writes payouts, and locks the pot. This cannot be
        undone.
      </p>
      <p className="text-xs" style={{ color: '#8b7355' }}>
        {paidCount} paid opt-in{paidCount === 1 ? '' : 's'} · {eligibleCount}{' '}
        eligible
      </p>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {confirming ? (
        <div className="flex items-center gap-2">
          <button
            onClick={handleSettle}
            disabled={working}
            className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: '#7c3a0c', color: '#fff' }}
          >
            {working ? 'Settling…' : 'Yes, settle'}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={working}
            className="text-sm hover:underline"
            style={{ color: '#8b7355' }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="px-4 py-2 rounded text-sm font-medium border"
          style={{ borderColor: '#7c3a0c', color: '#7c3a0c' }}
        >
          Settle pot…
        </button>
      )}
    </section>
  );
}

// ── Payouts ───────────────────────────────────────────────────────────────────

function PayoutsSection({ payouts }: { payouts: Payout[] }) {
  return (
    <section
      className="border rounded-lg p-4 space-y-2"
      style={{ borderColor: '#d4b896' }}
    >
      <h2 className="font-semibold" style={{ color: '#2c1810' }}>
        Payouts (frozen)
      </h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b" style={{ borderColor: '#e8d5b7' }}>
            <th className="text-left py-1">Place</th>
            <th className="text-left py-1">Back #</th>
            <th className="text-left py-1">Exhibitor</th>
            <th className="text-right py-1">Aggregate</th>
            <th className="text-right py-1">Payout</th>
          </tr>
        </thead>
        <tbody>
          {payouts.map((p) => (
            <tr
              key={p.id}
              className="border-b"
              style={{ borderColor: '#f0e6d2' }}
            >
              <td className="py-1">{p.place}</td>
              <td className="py-1 font-mono">#{p.back_number ?? '—'}</td>
              <td className="py-1">
                {p.exhibitor_name ?? '—'}
                {p.tiebreaker_notes && (
                  <span
                    className="text-xs ml-2"
                    style={{ color: '#8b7355' }}
                    title={p.tiebreaker_notes}
                  >
                    (tied)
                  </span>
                )}
              </td>
              <td className="py-1 text-right">
                {p.aggregate_value.toFixed(2)}
              </td>
              <td className="py-1 text-right font-medium">
                {formatCents(p.payout_cents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── Delete ────────────────────────────────────────────────────────────────────

function DeletePotSection({
  showId,
  pot,
}: {
  showId: string;
  pot: SidePot;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setError(null);
    setWorking(true);
    const res = await fetch(`/api/shows/${showId}/side-pots/${pot.id}`, {
      method: 'DELETE',
    });
    setWorking(false);
    if (res.ok || res.status === 204) {
      router.push(`/admin/shows/${showId}/side-pots`);
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to delete pot.');
    }
  };

  return (
    <section className="pt-2">
      {error && <p className="text-red-600 text-sm mb-1">{error}</p>}
      {confirming ? (
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: '#5c3d1e' }}>
            Delete this pot and all opt-ins?
          </span>
          <button
            onClick={handleDelete}
            disabled={working}
            className="text-xs text-red-600 hover:underline disabled:opacity-50"
          >
            {working ? 'Deleting…' : 'Yes, delete'}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={working}
            className="text-xs hover:underline"
            style={{ color: '#8b7355' }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="text-sm text-red-600 hover:text-red-800"
        >
          Delete pot
        </button>
      )}
    </section>
  );
}
