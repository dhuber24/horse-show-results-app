'use client';

import { useMemo, useState } from 'react';

/**
 * One judge's card for one entry: maneuvers, penalties, and what it adds up to.
 *
 * The scribe screens have always taken the *total* — the number somebody worked
 * out on paper and keyed in. This is the paper. Base score, a run of maneuver or
 * fence scores, penalties off the top, and the sum.
 *
 * **Saved explicitly, not on the autosave settle.** A card is a thing somebody
 * finishes and hands in, and the 1.5s debounce that suits a grid of numbers
 * would fire mid-sentence here — while a scribe is halfway through adding a
 * penalty they have not typed the value for yet. The score it produces then
 * goes into the sheet, which autosaves as it always did.
 */

const INK = '#2c1810';
const MUTED = '#8b7355';
const BORDER = '#d4b896';

export interface JudgingPenalty {
  id: string;
  code: string | null;
  label: string;
  value: number | null;
  min_value: number | null;
  max_value: number | null;
  applies_to: string;
}

export interface JudgingSystem {
  id: string;
  code: string;
  name: string;
  base_score: number | null;
  maneuver_min: number;
  maneuver_max: number;
  maneuver_step: number;
  unit_label: string;
  unit_count: number | null;
  score_max: number | null;
  notes: string | null;
  penalties: JudgingPenalty[];
}

export interface JudgeCard {
  entry_id: string;
  judge_id: string | null;
  computed_score: number | null;
  override_score: number | null;
  override_reason: string | null;
  maneuvers: { sequence: number; score: number | null; label: string | null }[];
  penalties: { penalty_id: string | null; label: string; value: number; sequence: number | null }[];
  effective_score: number | null;
  is_overridden: boolean;
}

interface DraftPenalty {
  penalty_id: string | null;
  label: string;
  value: string;
  sequence: string;
}

/** How many rows to draw. The system says, or the card already has more —
 *  a trail pattern has as many obstacles as the judge built. */
const DEFAULT_ROWS = 8;

function rowCount(system: JudgingSystem, card: JudgeCard | null): number {
  const filed = card?.maneuvers.length ?? 0;
  return Math.max(system.unit_count ?? DEFAULT_ROWS, filed, 1);
}

/** Mirrors `compute_score` in backend/judging.py — the server's figure is
 *  authoritative and comes back on save; this is what the scribe watches while
 *  they type. */
function localTotal(
  system: JudgingSystem,
  scores: string[],
  penalties: DraftPenalty[],
): number | null {
  const marked = scores.filter((s) => s !== '' && !Number.isNaN(parseFloat(s)));
  const applied = penalties.filter((p) => !Number.isNaN(parseFloat(p.value)));
  if (marked.length === 0 && applied.length === 0) return null;
  let total = system.base_score ?? 0;
  for (const s of marked) total += parseFloat(s);
  for (const p of applied) total -= parseFloat(p.value);
  if (system.score_max != null) total = Math.min(total, system.score_max);
  return Math.max(total, 0);
}

export default function JudgeCardPanel({
  showId,
  classId,
  entryId,
  judgeId,
  subject,
  system,
  card,
  onSaved,
  onClose,
}: {
  showId: string;
  classId: string;
  entryId: string;
  judgeId: string | null;
  subject: string;
  system: JudgingSystem;
  card: JudgeCard | null;
  /** Hands the saved card back so the sheet can take its score. */
  onSaved: (card: JudgeCard) => void;
  onClose: () => void;
}) {
  const rows = rowCount(system, card);

  const [scores, setScores] = useState<string[]>(() => {
    const filed = new Map((card?.maneuvers ?? []).map((m) => [m.sequence, m.score]));
    return Array.from({ length: rows }, (_, i) => {
      const value = filed.get(i + 1);
      return value == null ? '' : String(value);
    });
  });
  const [penalties, setPenalties] = useState<DraftPenalty[]>(() =>
    (card?.penalties ?? []).map((p) => ({
      penalty_id: p.penalty_id,
      label: p.label,
      value: String(p.value),
      sequence: p.sequence == null ? '' : String(p.sequence),
    })),
  );
  const [override, setOverride] = useState(
    card?.override_score == null ? '' : String(card.override_score),
  );
  const [overrideReason, setOverrideReason] = useState(card?.override_reason ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  const computed = useMemo(
    () => localTotal(system, scores, penalties),
    [system, scores, penalties],
  );
  const overrideValue = override === '' ? null : parseFloat(override);
  const effective =
    overrideValue != null && !Number.isNaN(overrideValue) ? overrideValue : computed;

  const setScore = (index: number, value: string) =>
    setScores((prev) => prev.map((s, i) => (i === index ? value : s)));

  const addPenalty = (source?: JudgingPenalty) =>
    setPenalties((prev) => [
      ...prev,
      {
        penalty_id: source?.id ?? null,
        label: source?.label ?? '',
        value: source?.value != null ? String(source.value) : '',
        sequence: '',
      },
    ]);

  const setPenalty = (index: number, patch: Partial<DraftPenalty>) =>
    setPenalties((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  const removePenalty = (index: number) =>
    setPenalties((prev) => prev.filter((_, i) => i !== index));

  async function save() {
    setSaving(true);
    setError(null);
    setIssues([]);
    try {
      const res = await fetch(
        `/api/shows/${showId}/classes/${classId}/entries/${entryId}/card`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            judge_id: judgeId,
            system_id: system.id,
            maneuvers: scores.map((s, i) => ({
              sequence: i + 1,
              score: s === '' ? null : parseFloat(s),
            })),
            // A penalty with no value typed yet is a row the scribe is still
            // filling in, not a zero-point penalty.
            penalties: penalties
              .filter((p) => p.label.trim() !== '' && !Number.isNaN(parseFloat(p.value)))
              .map((p) => ({
                penalty_id: p.penalty_id,
                label: p.label.trim(),
                value: parseFloat(p.value),
                sequence: p.sequence === '' ? null : parseInt(p.sequence, 10),
              })),
            override_score:
              overrideValue != null && !Number.isNaN(overrideValue) ? overrideValue : null,
            override_reason: overrideReason.trim() || null,
          }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = json?.detail;
        if (detail && typeof detail === 'object' && detail.code === 'CARD_INVALID') {
          setIssues(detail.issues ?? []);
          setError(detail.message);
          return;
        }
        setError(typeof detail === 'string' ? detail : 'Failed to save the card.');
        return;
      }
      onSaved(json as JudgeCard);
    } catch {
      setError('Network error — the card is still on screen.');
    } finally {
      setSaving(false);
    }
  }

  const step = system.maneuver_step || 0.5;

  return (
    <div
      className="mb-4 rounded-lg border p-4"
      style={{ borderColor: BORDER, backgroundColor: '#fffdf9' }}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
        <div>
          <p className="font-semibold" style={{ color: INK }}>
            {subject}
          </p>
          <p className="text-xs" style={{ color: MUTED }}>
            {system.name}
            {system.base_score != null && ` · base ${system.base_score}`}
            {` · ${system.unit_label.toLowerCase()}s ${system.maneuver_min} to ${system.maneuver_max}`}
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-sm hover:underline" style={{ color: MUTED }}>
          Close
        </button>
      </div>

      {system.notes && (
        <p
          className="text-xs mb-3 px-2 py-1.5 rounded"
          style={{ backgroundColor: '#faf7f2', color: MUTED, border: `1px solid #e8ddd0` }}
        >
          {system.notes}
        </p>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        {scores.map((value, i) => (
          <label key={i} className="flex flex-col items-center">
            <span className="text-xs mb-1" style={{ color: MUTED }}>
              {system.unit_label} {i + 1}
            </span>
            <input
              type="number"
              step={step}
              min={system.maneuver_min}
              max={system.maneuver_max}
              value={value}
              onChange={(e) => setScore(i, e.target.value)}
              className="w-16 min-h-[44px] border rounded-lg px-1 text-center text-base"
              style={{ borderColor: BORDER, backgroundColor: '#ffffff' }}
              placeholder="0"
            />
          </label>
        ))}
      </div>

      <div className="mb-4">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="text-sm font-semibold" style={{ color: INK }}>
            Penalties
          </span>
          {system.penalties.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => addPenalty(p)}
              className="text-xs px-2 py-1 rounded border hover:underline"
              style={{ borderColor: BORDER, color: '#8b4513' }}
              title={p.value != null ? `${p.value} points` : `${p.min_value}–${p.max_value} points`}
            >
              + {p.code ?? p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => addPenalty()}
            className="text-xs px-2 py-1 rounded border hover:underline"
            style={{ borderColor: BORDER, color: MUTED }}
            title="A penalty the judge called that is not in the catalog. Type what they said and what it cost."
          >
            + Other
          </button>
        </div>

        {penalties.length === 0 ? (
          <p className="text-xs" style={{ color: MUTED }}>
            None recorded.
          </p>
        ) : (
          <ul className="space-y-2">
            {penalties.map((p, i) => (
              <li key={i} className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  value={p.label}
                  onChange={(e) => setPenalty(i, { label: e.target.value })}
                  className="flex-1 min-w-[10rem] min-h-[44px] border rounded-lg px-2 text-sm"
                  style={{ borderColor: BORDER, backgroundColor: '#ffffff' }}
                  placeholder="What the judge called"
                />
                <input
                  type="number"
                  step="0.5"
                  value={p.value}
                  onChange={(e) => setPenalty(i, { value: e.target.value })}
                  className="w-20 min-h-[44px] border rounded-lg px-2 text-center text-sm"
                  style={{ borderColor: BORDER, backgroundColor: '#ffffff' }}
                  placeholder="pts"
                />
                <input
                  type="number"
                  min={1}
                  value={p.sequence}
                  onChange={(e) => setPenalty(i, { sequence: e.target.value })}
                  className="w-20 min-h-[44px] border rounded-lg px-2 text-center text-sm"
                  style={{ borderColor: BORDER, backgroundColor: '#ffffff' }}
                  placeholder={`${system.unit_label} #`}
                  title={`Which ${system.unit_label.toLowerCase()} it happened on. Leave blank for the run as a whole.`}
                />
                <button
                  type="button"
                  onClick={() => removePenalty(i)}
                  className="text-xs hover:underline"
                  style={{ color: '#991b1b' }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div
        className="flex items-center gap-4 flex-wrap p-3 rounded mb-3"
        style={{ backgroundColor: '#faf7f2', border: `1px solid #e8ddd0` }}
      >
        <div>
          <p className="text-xs" style={{ color: MUTED }}>
            Card total
          </p>
          <p className="text-2xl font-bold leading-none" style={{ color: INK }}>
            {computed ?? '—'}
          </p>
        </div>
        <label className="flex flex-col">
          <span className="text-xs mb-1" style={{ color: MUTED }}>
            Override
          </span>
          <input
            type="number"
            step="0.5"
            value={override}
            onChange={(e) => setOverride(e.target.value)}
            className="w-24 min-h-[44px] border rounded-lg px-2 text-center"
            style={{ borderColor: BORDER, backgroundColor: '#ffffff' }}
            placeholder="—"
            title="Use the judge's own number instead of the card's arithmetic. Recorded in the audit history."
          />
        </label>
        {override !== '' && (
          <label className="flex flex-col flex-1 min-w-[12rem]">
            <span className="text-xs mb-1" style={{ color: MUTED }}>
              Why
            </span>
            <input
              type="text"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              className="min-h-[44px] border rounded-lg px-2 text-sm"
              style={{ borderColor: BORDER, backgroundColor: '#ffffff' }}
              placeholder="What the judge said"
            />
          </label>
        )}
        <div className="ml-auto text-right">
          <p className="text-xs" style={{ color: MUTED }}>
            Score
          </p>
          <p className="text-2xl font-bold leading-none" style={{ color: '#8b4513' }}>
            {effective ?? '—'}
          </p>
        </div>
      </div>

      {error && (
        <div
          className="mb-3 px-3 py-2 rounded text-sm"
          style={{ backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5' }}
        >
          <p>⚠ {error}</p>
          {issues.length > 0 && (
            <ul className="list-disc pl-5 mt-1">
              {issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="min-h-[44px] px-5 rounded-lg font-semibold text-sm disabled:opacity-50"
          style={{ backgroundColor: INK, color: '#f5ede0' }}
        >
          {saving ? 'Saving…' : 'Save card'}
        </button>
        <span className="text-xs" style={{ color: MUTED }}>
          The score goes onto the sheet when you save.
        </span>
      </div>
    </div>
  );
}
