'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import TouchScorePad from './TouchScorePad';
import PublishBar from './PublishBar';
import JudgeTabs from './JudgeTabs';
import { useAutosave } from './useAutosave';
import { buildCards, groupByCard, type ShowJudge } from './judges';

interface Entry {
  id: string;
  back_number: number | null;
  exhibitorName: string;
  horseName: string;
  is_disqualified: boolean;
}

interface Result {
  id: string;
  entry_id: string;
  judge_id: string | null;
  place: number;
  is_tie: boolean;
  notes: string;
}

interface Class {
  id: string;
  class_number: string;
  class_name: string;
}

interface Props {
  showId: string;
  classId: string;
  classes: Class[];
  entries: Entry[];
  results: Result[];
  judges: ShowJudge[];
  resultsPublishedAt: string | null;
}

/** Missing place numbers in a card, e.g. 1, 2, 4 → [3]. */
function gapsIn(card: Record<string, string>): number[] {
  const assigned = new Set<number>();
  for (const val of Object.values(card)) {
    const p = parseInt(val);
    if (!isNaN(p) && p >= 1) assigned.add(p);
  }
  if (assigned.size === 0) return [];
  const missing: number[] = [];
  for (let i = 1; i <= Math.max(...assigned); i++) {
    if (!assigned.has(i)) missing.push(i);
  }
  return missing;
}

export default function ScribeForm({
  showId,
  classId,
  classes,
  entries,
  results,
  judges,
  resultsPublishedAt,
}: Props) {
  // Offer the unassigned card only when something is actually filed against it,
  // so a normal panel show shows exactly its judges.
  const cards = useMemo(
    () => buildCards(judges, results.some((r) => r.judge_id == null)),
    [judges, results]
  );

  const activeEntries = useMemo(() =>
    entries
      .filter((e) => !e.is_disqualified)
      .sort((a, b) => (a.back_number ?? 9999) - (b.back_number ?? 9999)),
    [entries]
  );
  const dqEntries = useMemo(() => entries.filter((e) => e.is_disqualified), [entries]);

  // One card per judge, each a full entry_id → place map. Seeded from whatever
  // each judge has already filed; a judge who has not started gets blanks.
  const [byCard, setByCard] = useState<Record<string, Record<string, string>>>(() => {
    const grouped = groupByCard(results);
    return Object.fromEntries(
      cards.map((card) => {
        const existing = Object.fromEntries(
          (grouped[card.key] ?? []).map((r) => [r.entry_id, r]),
        );
        return [
          card.key,
          Object.fromEntries(
            entries.map((e) => [e.id, existing[e.id]?.place?.toString() ?? '']),
          ),
        ];
      }),
    );
  });
  const [activeKey, setActiveKey] = useState(cards[0].key);
  const [publishedAt, setPublishedAt] = useState<string | null>(resultsPublishedAt);
  const [confirmClear, setConfirmClear] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const activeCard = cards.find((c) => c.key === activeKey) ?? cards[0];
  // Memoised: the `?? {}` fallback would otherwise be a fresh object every
  // render, re-running every memo downstream of it on every keystroke.
  const places = useMemo(() => byCard[activeKey] ?? {}, [byCard, activeKey]);

  const classIndex = classes.findIndex((c) => c.id === classId);
  const prevClass = classIndex > 0 ? classes[classIndex - 1] : null;
  const nextClass = classIndex < classes.length - 1 ? classes[classIndex + 1] : null;

  // Count how many entries share each place — any place with 2+ is a tie
  const placeCount = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const val of Object.values(places)) {
      const p = parseInt(val);
      if (!isNaN(p) && p > 0) counts[p] = (counts[p] ?? 0) + 1;
    }
    return counts;
  }, [places]);

  const isTie = useCallback((entryId: string) => {
    const p = parseInt(places[entryId]);
    return !isNaN(p) && p > 0 && (placeCount[p] ?? 0) > 1;
  }, [places, placeCount]);

  const placedCount = useMemo(() =>
    activeEntries.filter((e) => {
      const p = parseInt(places[e.id]);
      return !isNaN(p) && p >= 1;
    }).length,
    [activeEntries, places]
  );

  /** Placings filled in on each card, for the tab strip. */
  const filledByCard = useMemo(() =>
    Object.fromEntries(
      cards.map((card) => [
        card.key,
        activeEntries.filter((e) => {
          const p = parseInt(byCard[card.key]?.[e.id] ?? '');
          return !isNaN(p) && p >= 1;
        }).length,
      ]),
    ),
    [cards, byCard, activeEntries]
  );

  // Detect skipped place numbers (e.g. 1, 2, 4 missing 3). Mid-entry gaps are
  // normal now that the form autosaves, so this only gates the publish button —
  // and it covers every judge's card, because posting the class posts all of
  // them and the gap may well be on a tab nobody is looking at.
  const gapWarning = useMemo(() => {
    const warnings = cards
      .map((card) => ({ label: card.label, missing: gapsIn(byCard[card.key] ?? {}) }))
      .filter((w) => w.missing.length > 0);
    return warnings.length > 0 ? warnings : null;
  }, [cards, byCard]);

  const buildItems = useCallback((card: Record<string, string>) =>
    activeEntries
      .filter((entry) => {
        const p = parseInt(card[entry.id]);
        return !isNaN(p) && p >= 1;
      })
      .map((entry) => {
        const place = parseInt(card[entry.id]);
        const shared = activeEntries.filter((e) => parseInt(card[e.id]) === place).length;
        return { entry_id: entry.id, place, is_tie: shared > 1 };
      }),
    [activeEntries]
  );

  // The payload carries the judge, and `save` reads it back out rather than
  // reaching for current state: the card being committed is the one that was
  // debounced, which is not necessarily the one now on screen.
  const payload = useMemo(
    () => JSON.stringify({ judgeId: activeCard.judgeId, results: buildItems(places) }),
    [activeCard.judgeId, buildItems, places]
  );

  const save = useCallback(async (snapshot: string) => {
    const res = await fetch('/api/results', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId, classId, ...JSON.parse(snapshot) }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail ?? 'Failed to save');
    }
  }, [showId, classId]);

  const { status, lastSavedAt, error, flush } = useAutosave({
    payload,
    save,
    baselineKey: activeKey,
  });

  const setPlace = (entryId: string, value: string) => {
    setByCard((prev) => ({
      ...prev,
      [activeKey]: { ...prev[activeKey], [entryId]: value },
    }));
  };

  /** Commit the open card before showing another — it may hold an unsettled
   *  keystroke, and only one card is held in the autosave payload at a time. */
  const selectCard = async (key: string) => {
    if (key === activeKey) return;
    await flush();
    setSelectedIndex(null);
    setActiveKey(key);
  };

  const handleClearAll = () => {
    setByCard((prev) => ({
      ...prev,
      [activeKey]: Object.fromEntries(entries.map((e) => [e.id, ''])),
    }));
    setSelectedIndex(null);
  };

  const selectedEntry = selectedIndex !== null ? activeEntries[selectedIndex] : null;

  /** Places held by rows other than the selected one — shown as used on the pad. */
  const takenPlaces = useMemo(() => {
    const taken = new Set<number>();
    activeEntries.forEach((e, i) => {
      if (i === selectedIndex) return;
      const p = parseInt(places[e.id]);
      if (!isNaN(p) && p >= 1) taken.add(p);
    });
    return taken;
  }, [activeEntries, places, selectedIndex]);

  // The pad is docked over the bottom of the page, so the row being placed can
  // end up behind it — especially when "Next horse" walks down the list.
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  useEffect(() => {
    if (selectedIndex === null) return;
    rowRefs.current[selectedIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [selectedIndex]);

  return (
    <div className={selectedEntry ? 'pb-72' : undefined}>
      {/* Class navigation */}
      {classes.length > 1 && (
        <div className="flex items-center justify-between mb-5 text-sm">
          {prevClass ? (
            <Link
              href={`/shows/${showId}/classes/${prevClass.id}/scribe`}
              className="font-medium hover:underline min-h-[44px] flex items-center"
              style={{ color: '#8b4513' }}
            >
              ← {prevClass.class_number}
            </Link>
          ) : <span />}
          <span style={{ color: '#8b7355' }}>Class {classIndex + 1} of {classes.length}</span>
          {nextClass ? (
            <Link
              href={`/shows/${showId}/classes/${nextClass.id}/scribe`}
              className="font-medium hover:underline min-h-[44px] flex items-center"
              style={{ color: '#8b4513' }}
            >
              {nextClass.class_number} →
            </Link>
          ) : <span />}
        </div>
      )}

      <PublishBar
        showId={showId}
        classId={classId}
        status={status}
        lastSavedAt={lastSavedAt}
        error={error}
        onRetry={() => void flush()}
        publishedAt={publishedAt}
        onPublished={setPublishedAt}
        gapWarning={gapWarning}
        empty={Object.values(filledByCard).every((n) => n === 0)}
        flush={flush}
      />

      <JudgeTabs
        cards={cards}
        activeKey={activeKey}
        onSelect={(key) => void selectCard(key)}
        filledByCard={filledByCard}
        total={activeEntries.length}
      />

      {/* Progress */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm" style={{ color: '#8b7355' }}>
          {placedCount} of {activeEntries.length} placed
          {dqEntries.length > 0 && ` · ${dqEntries.length} DQ`}
        </span>
        {confirmClear ? (
          <span className="flex items-center gap-2">
            <span className="text-xs" style={{ color: '#5c3d1e' }}>
              Clear {cards.length > 1 ? `${activeCard.label}'s` : 'all'} placings?
            </span>
            <button type="button" onClick={() => { setConfirmClear(false); handleClearAll(); }}
              className="text-xs text-red-600 hover:underline">Yes</button>
            <button type="button" onClick={() => setConfirmClear(false)}
              className="text-xs hover:underline" style={{ color: '#8b7355' }}>Cancel</button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="text-xs hover:underline"
            style={{ color: '#8b7355' }}
          >
            Clear all
          </button>
        )}
      </div>

      <table className="w-full border-collapse mb-4">
        <thead>
          <tr className="text-left" style={{ borderBottom: '2px solid #d4b896' }}>
            <th className="py-2 pr-4 text-sm font-semibold" style={{ color: '#2c1810' }}>Back #</th>
            <th className="py-2 pr-4 text-sm font-semibold" style={{ color: '#2c1810' }}>Exhibitor</th>
            <th className="py-2 pr-4 text-sm font-semibold hidden md:table-cell" style={{ color: '#2c1810' }}>Horse</th>
            <th className="py-2 text-sm font-semibold" style={{ color: '#2c1810' }}>Place</th>
          </tr>
        </thead>
        <tbody>
          {activeEntries.map((entry, i) => {
            const tied = isTie(entry.id);
            const isSelected = selectedIndex === i;
            return (
              <tr
                key={entry.id}
                ref={(el) => { rowRefs.current[i] = el; }}
                onClick={() => setSelectedIndex(i)}
                style={{
                  borderBottom: '1px solid #e8ddd0',
                  backgroundColor: isSelected ? '#f5ede0' : tied ? '#fffbeb' : undefined,
                  cursor: 'pointer',
                  outline: isSelected ? '2px solid #8b4513' : undefined,
                }}
              >
                <td className="py-4 pr-4 font-medium text-base" style={{ color: '#2c1810' }}>
                  {entry.back_number ?? '—'}
                </td>
                <td className="py-4 pr-4 text-base" style={{ color: '#2c1810' }}>{entry.exhibitorName}</td>
                <td className="py-4 pr-4 hidden md:table-cell" style={{ color: '#8b7355' }}>{entry.horseName}</td>
                <td className="py-4">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      // The pad drives entry; suppressing the OS keyboard is
                      // the whole point on a tablet. Keyboard users can still
                      // type into it — it is a real input, just not one that
                      // summons a 50%-of-screen keypad.
                      inputMode="none"
                      value={places[entry.id] ?? ''}
                      onFocus={() => setSelectedIndex(i)}
                      onChange={(e) => setPlace(entry.id, e.target.value)}
                      className="w-20 min-h-[44px] border rounded-lg px-2 text-center text-lg"
                      style={{
                        borderColor: isSelected ? '#8b4513' : '#d4b896',
                        backgroundColor: '#fffdf9',
                      }}
                      placeholder="—"
                    />
                    {tied && (
                      <span
                        className="text-xs font-semibold px-2 py-0.5 rounded"
                        style={{ backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }}
                      >
                        TIE
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
          {dqEntries.map((entry) => (
            <tr key={entry.id} style={{ borderBottom: '1px solid #e8ddd0', backgroundColor: '#f9f9f9' }}>
              <td className="py-4 pr-4 text-sm" style={{ color: '#bbb' }}>{entry.back_number ?? '—'}</td>
              <td className="py-4 pr-4 text-sm" style={{ color: '#bbb' }}>{entry.exhibitorName}</td>
              <td className="py-4 pr-4 text-sm hidden md:table-cell" style={{ color: '#bbb' }}>{entry.horseName}</td>
              <td className="py-4">
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded"
                  style={{ backgroundColor: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' }}
                >
                  DQ
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {gapsIn(places).length > 0 && (
        <div
          className="mb-3 px-3 py-2 rounded text-sm"
          style={{ backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }}
        >
          ⚠ Place gap — missing: {gapsIn(places).join(', ')}
        </div>
      )}

      <TouchScorePad
        mode="placement"
        subject={
          selectedEntry
            ? `${selectedEntry.back_number ?? '—'} · ${selectedEntry.exhibitorName}`
            : null
        }
        value={selectedEntry ? places[selectedEntry.id] ?? '' : ''}
        onChange={(next) => selectedEntry && setPlace(selectedEntry.id, next)}
        onNext={() =>
          setSelectedIndex((i) =>
            i !== null && i < activeEntries.length - 1 ? i + 1 : null
          )
        }
        onClose={() => setSelectedIndex(null)}
        maxPlace={activeEntries.length}
        takenPlaces={takenPlaces}
      />
    </div>
  );
}
