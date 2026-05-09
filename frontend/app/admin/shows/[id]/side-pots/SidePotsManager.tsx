'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

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
  name: string;
  description: string | null;
  entry_fee_cents: number;
  payback_percent: number;
  scoring_method: ScoringMethod;
  eligibility_rule: EligibilityRule;
  status: Status;
  classes: PotClass[];
  entry_count: number;
  paid_count: number;
}

const STATUS_BADGE: Record<Status, { label: string; bg: string; fg: string }> = {
  open: { label: 'Open', bg: '#dcebd5', fg: '#3f6b2f' },
  closed: { label: 'Closed', bg: '#f0e8d8', fg: '#8b4513' },
  settled: { label: 'Settled', bg: '#d4d4d4', fg: '#404040' },
};

const formatCents = (cents: number) =>
  `$${(cents / 100).toFixed(2)}`;

export default function SidePotsManager({
  showId,
  initialPots,
  classes,
}: {
  showId: string;
  initialPots: SidePot[];
  classes: ClassItem[];
}) {
  const [pots] = useState<SidePot[]>(initialPots);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-4">
      {!creating && (
        <button
          onClick={() => setCreating(true)}
          className="px-4 py-2 rounded text-sm font-medium"
          style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
        >
          + Create Side Pot
        </button>
      )}

      {creating && (
        <CreatePotForm
          showId={showId}
          classes={classes}
          onCancel={() => setCreating(false)}
        />
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold" style={{ color: '#2c1810' }}>
          Pots
          <span className="ml-2 text-sm font-normal" style={{ color: '#8b7355' }}>
            ({pots.length})
          </span>
        </h2>
        {pots.length === 0 ? (
          <p className="text-sm" style={{ color: '#8b7355' }}>
            No side pots yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {pots.map((pot) => (
              <li key={pot.id}>
                <Link
                  href={`/admin/shows/${showId}/side-pots/${pot.id}`}
                  className="block p-3 rounded-lg border hover:bg-gray-50 transition"
                  style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="font-medium"
                          style={{ color: '#2c1810' }}
                        >
                          {pot.name}
                        </span>
                        <span
                          className="text-xs px-2 py-0.5 rounded-full"
                          style={{
                            backgroundColor: STATUS_BADGE[pot.status].bg,
                            color: STATUS_BADGE[pot.status].fg,
                          }}
                        >
                          {STATUS_BADGE[pot.status].label}
                        </span>
                        <span
                          className="text-xs"
                          style={{ color: '#8b7355' }}
                        >
                          · {formatCents(pot.entry_fee_cents)} entry
                        </span>
                        <span
                          className="text-xs"
                          style={{ color: '#8b7355' }}
                        >
                          · {pot.payback_percent}% payback
                        </span>
                        <span
                          className="text-xs font-mono px-1 rounded"
                          style={{ backgroundColor: '#f0e8d8', color: '#8b4513' }}
                          title="Scoring method"
                        >
                          {pot.scoring_method === 'sum_scores'
                            ? 'Sum scores'
                            : 'Sum placings'}
                        </span>
                      </div>
                      {pot.description && (
                        <p
                          className="text-sm mt-1"
                          style={{ color: '#5c3d1e' }}
                        >
                          {pot.description}
                        </p>
                      )}
                      <p
                        className="text-xs mt-1"
                        style={{ color: '#8b7355' }}
                      >
                        {pot.classes.length} class
                        {pot.classes.length === 1 ? '' : 'es'} ·{' '}
                        {pot.entry_count} opt-in
                        {pot.entry_count === 1 ? '' : 's'} ({pot.paid_count}{' '}
                        paid)
                      </p>
                    </div>
                    <span className="text-sm" style={{ color: '#8b7355' }}>
                      Manage →
                    </span>
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

function CreatePotForm({
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
  const [feeDollars, setFeeDollars] = useState('10.00');
  const [paybackPercent, setPaybackPercent] = useState('100');
  const [scoringMethod, setScoringMethod] =
    useState<ScoringMethod>('sum_placings');
  const [eligibilityRule, setEligibilityRule] =
    useState<EligibilityRule>('all_classes');
  const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(
    new Set(),
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

  const toggleClass = (id: string) => {
    setSelectedClassIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async () => {
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
    if (Number.isNaN(feeCents) || feeCents < 0) {
      setError('Entry fee must be a non-negative number.');
      return;
    }
    const payback = parseInt(paybackPercent, 10);
    if (Number.isNaN(payback) || payback < 0 || payback > 100) {
      setError('Payback percent must be between 0 and 100.');
      return;
    }

    setSaving(true);
    const res = await fetch(`/api/shows/${showId}/side-pots`, {
      method: 'POST',
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
      const pot = await res.json();
      router.push(`/admin/shows/${showId}/side-pots/${pot.id}`);
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to create side pot.');
    }
  };

  // Group classes by date for display
  const groupedFiltered = useMemo(() => {
    const map = new Map<string, ClassItem[]>();
    for (const c of filtered) {
      const arr = map.get(c.class_date) ?? [];
      arr.push(c);
      map.set(c.class_date, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <div
      className="border rounded-lg p-4 space-y-4"
      style={{ borderColor: '#d4b896' }}
    >
      <h3 className="font-semibold" style={{ color: '#2c1810' }}>
        Create Side Pot
      </h3>

      <div className="space-y-3">
        <div>
          <label className="text-sm text-gray-500 block mb-1">Name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Showmanship Side Pot"
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <div>
          <label className="text-sm text-gray-500 block mb-1">
            Description
          </label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional"
            className="w-full border rounded px-3 py-2"
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
              className="w-full border rounded px-3 py-2"
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
              className="w-full border rounded px-3 py-2"
            />
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-sm text-gray-500 block mb-1">
              Scoring
            </label>
            <select
              value={scoringMethod}
              onChange={(e) =>
                setScoringMethod(e.target.value as ScoringMethod)
              }
              className="w-full border rounded px-3 py-2"
              title="Sum placings: lowest sum of class placings wins. Sum scores: highest sum of raw judge scores wins (only for pattern/time classes)."
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
              className="w-full border rounded px-3 py-2"
              title="All classes: must place in every bundled class to be ranked. Any class: missing classes count as last place + 1."
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
      </div>

      <div className="space-y-2">
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
            placeholder="Filter by number or name"
            className="text-sm border rounded px-2 py-1"
          />
        </div>
        {scoringMethod === 'sum_scores' && (
          <p className="text-xs" style={{ color: '#8b7355' }}>
            Showing only pattern and timed classes. Mark a class as Pattern or
            Timed in the class editor to make it eligible here.
          </p>
        )}
        <div
          className="border rounded overflow-y-auto"
          style={{ maxHeight: '320px', borderColor: '#e8d5b7' }}
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

      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="px-5 py-2 rounded text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
        >
          {saving ? 'Creating…' : 'Create pot'}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
