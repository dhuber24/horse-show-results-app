'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ClassItem, SidePot, ScoringMethod, EligibilityRule } from '../../pot-shared';

/**
 * The pot's settings form. No heading of its own — the page title is the
 * heading. Everything is one Save, because the fields interact: `sum_scores`
 * narrows which classes are even selectable, so saving the scoring method
 * separately from the class list could leave a pot the backend would reject.
 */
export default function SidePotSettingsForm({
  showId,
  pot: initialPot,
  classes,
}: {
  showId: string;
  pot: SidePot;
  classes: ClassItem[];
}) {
  const router = useRouter();
  // The saved pot, and the baseline the dirty check compares against.
  const [pot, setPot] = useState(initialPot);
  const [name, setName] = useState(pot.name);
  const [description, setDescription] = useState(pot.description ?? '');
  const [feeDollars, setFeeDollars] = useState((pot.entry_fee_cents / 100).toFixed(2));
  const [paybackPercent, setPaybackPercent] = useState(String(pot.payback_percent));
  const [scoringMethod, setScoringMethod] = useState<ScoringMethod>(pot.scoring_method);
  const [eligibilityRule, setEligibilityRule] = useState<EligibilityRule>(
    pot.eligibility_rule,
  );
  const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(
    new Set(pot.classes.map((c) => c.class_id)),
  );
  const [classFilter, setClassFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = pot.status === 'settled';

  const eligibleClasses = useMemo(() => {
    if (scoringMethod === 'sum_scores') {
      return classes.filter((c) => c.score_type === 'pattern' || c.score_type === 'time');
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
    setSaved(false);
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
      setError('Buy-in must be a non-negative number.');
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
      // The response is the new baseline, so the Save button goes quiet again.
      setPot(await res.json());
      setSaved(true);
      router.refresh();
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
    <div className="space-y-3">
      {disabled && (
        <div
          className="rounded border px-4 py-3 text-sm"
          style={{ backgroundColor: '#faf7f2', borderColor: '#d4b896', color: '#5d4a37' }}
        >
          This pot is settled. Its payouts were computed from these settings, so they are
          locked.
        </div>
      )}
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
          <label className="text-sm text-gray-500 block mb-1">Description</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border rounded px-3 py-2 disabled:bg-gray-50"
          />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-sm text-gray-500 block mb-1">Buy-in ($)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={feeDollars}
              onChange={(e) => setFeeDollars(e.target.value)}
              className="w-full border rounded px-3 py-2 disabled:bg-gray-50"
              title="What each back number pays to join this pot"
            />
          </div>
          <div className="flex-1">
            <label className="text-sm text-gray-500 block mb-1">Payback %</label>
            <input
              type="number"
              min="0"
              max="100"
              value={paybackPercent}
              onChange={(e) => setPaybackPercent(e.target.value)}
              className="w-full border rounded px-3 py-2 disabled:bg-gray-50"
              title="Share of the buy-ins paid back out; the rest the show keeps"
            />
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-sm text-gray-500 block mb-1">Scoring</label>
            <select
              value={scoringMethod}
              onChange={(e) => setScoringMethod(e.target.value as ScoringMethod)}
              className="w-full border rounded px-3 py-2 disabled:bg-gray-50"
              title="Sum placings: lowest sum of class placings wins. Sum scores: highest sum of raw judge scores wins (only for pattern/time classes)."
            >
              <option value="sum_placings">Sum of placings (lowest wins)</option>
              <option value="sum_scores">Sum of scores (highest wins)</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="text-sm text-gray-500 block mb-1">Eligibility</label>
            <select
              value={eligibilityRule}
              onChange={(e) => setEligibilityRule(e.target.value as EligibilityRule)}
              className="w-full border rounded px-3 py-2 disabled:bg-gray-50"
              title="All classes: must place in every bundled class to be ranked. Any class: missing classes count as last place + 1."
            >
              <option value="all_classes">Must place in every bundled class</option>
              <option value="any_class">Allow missing classes (last + 1)</option>
            </select>
          </div>
        </div>

        <div className="space-y-2 pt-2 border-t" style={{ borderColor: '#e8d5b7' }}>
          <div className="flex items-baseline justify-between gap-2">
            <label className="text-sm font-medium" style={{ color: '#2c1810' }}>
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
              <p className="p-3 text-sm" style={{ color: '#8b7355' }}>
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
                          style={{ backgroundColor: '#f0e8d8', color: '#8b4513' }}
                        >
                          #{c.class_number}
                        </span>
                        <span style={{ color: '#2c1810' }}>{c.class_name}</span>
                        {c.score_type !== 'placement' && (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded ml-auto"
                            style={{ backgroundColor: '#dcebd5', color: '#3f6b2f' }}
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
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving || !isDirty}
              title={!isDirty ? 'No changes to save' : undefined}
              className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
            >
              {saving ? 'Saving…' : 'Save settings'}
            </button>
            {saved && !isDirty && (
              <span className="text-sm" style={{ color: '#3f6b2f' }}>
                Saved.
              </span>
            )}
          </div>
        )}
      </fieldset>
    </div>
  );
}
