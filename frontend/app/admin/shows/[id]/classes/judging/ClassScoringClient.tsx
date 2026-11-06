'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api-error';
import { CARD_TYPES, sheetFits, takesSheet, type CardType } from '@/lib/card-types';

export type ScoringClass = {
  id: string;
  class_number: string;
  class_name: string;
  class_date: string;
  discipline_name: string | null;
  score_type: string;
  effective_card_type: CardType;
  judging_system_id: string | null;
  placed_count: number;
};

export type SheetOption = {
  id: string;
  code: string;
  name: string;
  /** Which score-based card type the sheet belongs to; null is offered to both. */
  card_type: 'scored' | 'equitation' | null;
  base_score: number | null;
  maneuver_min: number;
  maneuver_max: number;
  unit_label: string;
  unit_count: number | null;
  notes: string | null;
  penalties: { id: string; label: string; value: number | null }[];
};

const COLORS = {
  text: 'var(--foreground)',
  muted: 'var(--muted)',
  border: 'var(--border)',
  borderSoft: 'var(--bg-subtle)',
  bg: 'var(--surface)',
} as const;

const selectClass = 'min-h-[40px] border rounded-lg px-2 text-sm disabled:opacity-50';
const selectStyle = { borderColor: COLORS.border, color: COLORS.text, backgroundColor: COLORS.bg } as const;
const quietButton = { borderColor: COLORS.border, color: 'var(--accent)', backgroundColor: COLORS.bg } as const;

/** Placing, scoring and timing are three different things a placing can be,
 *  so a class with placings filed stays in its family (the backend refuses
 *  otherwise); scored and equitation are both scored. */
const FAMILY: Record<CardType, string> = {
  placing: 'placement',
  scored: 'pattern',
  equitation: 'pattern',
  timed: 'time',
};

type Row = { card: CardType; sheet: string };

function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/**
 * How every class is placed (migration 155): Placing, Scored / Numeric,
 * Equitation / Pattern, or Timed — and, for the two score-based cards, which
 * judge's-card sheet the scribe fills in.
 *
 * **Set in bulk.** A schedule is a hundred and fifty classes and most of them
 * share an answer, so it is a scoring configuration, not a filter: one bar —
 * *Select rows for:* a discipline, the scoring method, *Apply* — selects that
 * discipline's classes and applies one card type to every selected class in
 * one call. Rows can also be selected by hand, a day at a time, or all at once
 * (*Select all*), and the bar is pinned to the top of the screen while the list
 * scrolls, so the selection made a hundred rows down is applied without
 * scrolling back. A row's own picker is the same call with one class in it.
 * Every class starts on the card type its discipline implies, so most shows
 * only correct a few.
 */
export default function ClassScoringClient({
  showId,
  classes,
  sheets,
}: {
  showId: string;
  classes: ScoringClass[];
  sheets: SheetOption[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      classes.map((c) => [c.id, { card: c.effective_card_type, sheet: c.judging_system_id ?? '' }]),
    ),
  );
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  /** The discipline the bar last selected rows for — shown in its drop-down. */
  const [discipline, setDiscipline] = useState('');
  const [bulkCard, setBulkCard] = useState<CardType | ''>('');
  const [bulkSheet, setBulkSheet] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const byDay = useMemo(() => {
    const groups: Record<string, ScoringClass[]> = {};
    for (const c of classes) (groups[c.class_date] ??= []).push(c);
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [classes]);

  const disciplines = useMemo(
    () =>
      Array.from(new Set(classes.map((c) => c.discipline_name).filter((d): d is string => Boolean(d)))).sort(
        (a, b) => a.localeCompare(b),
      ),
    [classes],
  );

  const counts = useMemo(() => {
    const out: Record<CardType, number> = { placing: 0, scored: 0, equitation: 0, timed: 0 };
    for (const c of classes) out[rows[c.id]?.card ?? c.effective_card_type] += 1;
    return out;
  }, [classes, rows]);

  const sheetsFor = (card: CardType) => sheets.filter((s) => sheetFits(card, s.card_type));

  const tick = (ids: string[], on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  /**
   * One call for one class or many. `sheet` undefined leaves each class's sheet
   * to the backend (kept where it still fits the card type, cleared where it
   * does not); '' is "the scribe types the total".
   */
  async function apply(ids: string[], card: CardType, sheet?: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/shows/${showId}/classes/scoring`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          class_ids: ids,
          card_type: card,
          ...(sheet !== undefined ? { judging_system_id: sheet || null } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(errorMessage(body, 'The card type could not be applied.'));
        return false;
      }
      setRows((prev) => {
        const next = { ...prev };
        for (const id of ids) {
          const was = prev[id]?.sheet ?? '';
          const wasFits = was !== '' && sheetFits(card, sheets.find((s) => s.id === was)?.card_type);
          next[id] = { card, sheet: sheet !== undefined ? sheet : wasFits ? was : '' };
        }
        return next;
      });
      router.refresh();
      return true;
    } catch {
      setError('Network error — nothing was changed.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function applyTicked() {
    if (!bulkCard || ticked.size === 0) return;
    const ids = Array.from(ticked);
    const ok = await apply(ids, bulkCard, takesSheet(bulkCard) ? bulkSheet : '');
    if (ok) {
      const label = CARD_TYPES.find((t) => t.key === bulkCard)?.label;
      const allOfDiscipline =
        discipline !== '' &&
        classes.filter((c) => c.discipline_name === discipline).every((c) => ticked.has(c.id)) &&
        ids.every((id) => classes.find((c) => c.id === id)?.discipline_name === discipline);
      setNotice(
        `${label} applied to ${ids.length} ${allOfDiscipline ? `${discipline} ` : ''}class${ids.length === 1 ? '' : 'es'}.`,
      );
      setTicked(new Set());
      setDiscipline('');
    }
  }

  /** Select every class in a discipline, replacing what was selected: the bar
   *  configures a group, and a leftover selection would quietly join it. */
  function selectDiscipline(d: string) {
    setDiscipline(d);
    setTicked(new Set(d ? classes.filter((c) => c.discipline_name === d).map((c) => c.id) : []));
  }

  const allIds = classes.map((c) => c.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => ticked.has(id));

  if (classes.length === 0) {
    return (
      <div className="rounded border p-4 text-sm" style={{ borderColor: COLORS.border, color: COLORS.muted }}>
        This show has no classes yet. Build the schedule in the Class Builder, then choose how each is placed.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1 text-sm">
        <p className="font-semibold" style={{ color: COLORS.text }}>Options:</p>
        <ul className="list-disc pl-5 space-y-1">
          {CARD_TYPES.map((t) => (
            <li key={t.key} style={{ color: COLORS.muted }}>
              <span className="font-semibold" style={{ color: COLORS.text }}>{t.label}</span>{' '}
              ({counts[t.key]} class{counts[t.key] === 1 ? '' : 'es'}): {t.description}
            </li>
          ))}
        </ul>
      </div>

      {/* The bulk change: a discipline selects its rows, the scoring method
          says what they become, Apply writes it. Pinned to the top of the
          screen while the list scrolls, so rows selected by hand a hundred
          lines down are applied from where they were selected. */}
      <div
        className="sticky top-0 z-20 rounded-lg border p-3 flex flex-wrap items-center gap-2 text-sm"
        style={{ borderColor: ticked.size > 0 ? 'var(--accent)' : COLORS.border, backgroundColor: COLORS.bg }}
      >
        <span style={{ color: COLORS.muted }}>Select rows for:</span>
        <select
          value={discipline}
          onChange={(e) => selectDiscipline(e.target.value)}
          className={selectClass}
          style={selectStyle}
          aria-label="Select every class in a discipline"
        >
          <option value="">Choose a discipline…</option>
          {disciplines.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <select
          value={bulkCard}
          onChange={(e) => {
            setBulkCard(e.target.value as CardType | '');
            setBulkSheet('');
          }}
          className={selectClass}
          style={selectStyle}
          aria-label="Scoring method for the selected classes"
        >
          <option value="">Scoring method…</option>
          {CARD_TYPES.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
        {bulkCard && takesSheet(bulkCard) && sheetsFor(bulkCard).length > 0 && (
          <select
            value={bulkSheet}
            onChange={(e) => setBulkSheet(e.target.value)}
            className={selectClass}
            style={selectStyle}
            aria-label="Sheet for the selected classes"
          >
            <option value="">Scribe types the total</option>
            {sheetsFor(bulkCard).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={() => void applyTicked()}
          disabled={busy || !bulkCard || ticked.size === 0}
          title={
            ticked.size === 0
              ? 'Select a discipline, or tick rows, first'
              : !bulkCard
                ? 'Choose a scoring method first'
                : undefined
          }
          className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}
        >
          {busy ? 'Applying…' : ticked.size > 0 ? `Apply to ${ticked.size} class${ticked.size === 1 ? '' : 'es'}` : 'Apply'}
        </button>
        {ticked.size > 0 && (
          <button
            type="button"
            onClick={() => selectDiscipline('')}
            className="px-2.5 py-1 rounded border text-xs font-medium"
            style={quietButton}
          >
            Clear selection
          </button>
        )}
      </div>

      {/* Several days: one box selects the whole show, each day's own box its
          day. A one-day show's day box is already all of it, so it is labelled
          *Select all* instead of adding a second box that does the same. */}
      {byDay.length > 1 && (
        <label className="flex items-center gap-2 text-sm font-semibold" style={{ color: COLORS.text }}>
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(e) => {
              setDiscipline('');
              tick(allIds, e.target.checked);
            }}
          />
          Select all
        </label>
      )}

      {error && (
        <p
          className="text-sm rounded px-3 py-2"
          style={{ backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)', border: '1px solid var(--error-border)' }}
        >
          ⚠ {error}
        </p>
      )}
      {notice && !error && (
        <p className="text-sm" role="status" style={{ color: 'var(--success-strong)' }}>
          {notice}
        </p>
      )}

      {byDay.map(([day, dayClasses]) => {
        const dayIds = dayClasses.map((c) => c.id);
        const allTicked = dayIds.every((id) => ticked.has(id));
        return (
          <section key={day} className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-semibold" style={{ color: COLORS.text }}>
              <input
                type="checkbox"
                checked={allTicked}
                onChange={(e) => {
                  setDiscipline('');
                  tick(dayIds, e.target.checked);
                }}
                aria-label={byDay.length === 1 ? 'Select all' : `Select every class on ${formatDay(day)}`}
              />
              {byDay.length === 1 ? (
                <>
                  Select all
                  <span className="font-normal" style={{ color: COLORS.muted }}>· {formatDay(day)}</span>
                </>
              ) : (
                formatDay(day)
              )}
            </label>
            <ul className="rounded border divide-y" style={{ borderColor: COLORS.border }}>
              {dayClasses.map((c) => {
                const row = rows[c.id] ?? { card: c.effective_card_type, sheet: c.judging_system_id ?? '' };
                const locked = c.placed_count > 0;
                const offered = sheetsFor(row.card);
                return (
                  <li
                    key={c.id}
                    className="flex items-center gap-3 flex-wrap px-3 py-2"
                    style={{
                      borderColor: COLORS.borderSoft,
                      backgroundColor: ticked.has(c.id) ? 'var(--accent-bg)' : undefined,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={ticked.has(c.id)}
                      onChange={(e) => tick([c.id], e.target.checked)}
                      aria-label={`Select class ${c.class_number}`}
                    />
                    <span className="font-medium w-10" style={{ color: COLORS.text }}>{c.class_number}</span>
                    {/* On the desktop layout the name is a fixed column, so the
                        pickers line up just past it rather than at the far edge
                        of a window-wide row, a long way from the class they set. */}
                    <span className="flex-1 min-w-[10rem] desktop:flex-none desktop:w-[26rem]">
                      <span style={{ color: COLORS.text }}>{c.class_name}</span>
                      {c.discipline_name && (
                        <span className="block text-xs" style={{ color: COLORS.muted }}>{c.discipline_name}</span>
                      )}
                    </span>
                    {/* The two pickers wrap together, so a sheet never lands on a line
                        of its own under the tick box. */}
                    <span className="flex flex-wrap items-center justify-end gap-2 ml-auto desktop:ml-0 desktop:justify-start">
                    <select
                      value={row.card}
                      onChange={(e) => void apply([c.id], e.target.value as CardType)}
                      disabled={busy}
                      className={selectClass}
                      style={selectStyle}
                      aria-label={`How class ${c.class_number} is placed`}
                      title={locked ? 'Placings are filed on this class, so it stays placed the way they were filed.' : undefined}
                    >
                      {CARD_TYPES.map((t) => (
                        <option key={t.key} value={t.key} disabled={locked && FAMILY[t.key] !== FAMILY[row.card]}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    {takesSheet(row.card) && offered.length > 0 && (
                      <select
                        value={row.sheet}
                        onChange={(e) => void apply([c.id], row.card, e.target.value)}
                        disabled={busy}
                        className={selectClass}
                        style={selectStyle}
                        aria-label={`Sheet for class ${c.class_number}`}
                      >
                        <option value="">Scribe types the total</option>
                        {offered.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {sheets.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold" style={{ color: COLORS.text }}>
            The sheets a scored or equitation class can be marked on
          </h3>
          <p className="text-xs" style={{ color: COLORS.muted }}>
            Give a class a sheet and the scribe records each maneuver or fence and the penalties the judge
            calls; the total comes from those. Leave it on &ldquo;Scribe types the total&rdquo; and the scribe
            enters the judge&rsquo;s score.
          </p>
          {sheets.map((s) => (
            <div key={s.id} className="rounded border p-3 text-xs space-y-1" style={{ borderColor: COLORS.borderSoft, color: COLORS.muted }}>
              <p className="font-semibold" style={{ color: COLORS.text }}>
                {s.name}
                {s.card_type && (
                  <span className="ml-2 font-normal">· {s.card_type === 'equitation' ? 'Equitation / Pattern' : 'Scored / Numeric'}</span>
                )}
              </p>
              <p>
                {s.base_score != null && `Base ${s.base_score} · `}
                {s.unit_label.toLowerCase()}s scored {s.maneuver_min} to {s.maneuver_max}
                {s.unit_count != null && ` · ${s.unit_count} ${s.unit_label.toLowerCase()}s`}
                {s.penalties.length > 0 &&
                  ` · penalties ${s.penalties.map((p) => (p.value != null ? p.value : '—')).join(', ')}`}
              </p>
              {s.notes && <p>{s.notes}</p>}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
