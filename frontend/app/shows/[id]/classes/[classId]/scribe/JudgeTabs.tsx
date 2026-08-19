'use client';

import type { JudgeCard } from './judges';

/**
 * Which judge's card the scribe is filling in.
 *
 * Hidden entirely on a single-card class, which is every one-judge show — the
 * screen should not grow a chooser with one option in it.
 *
 * Switching cards flushes first (see the parent's handler): the outgoing card
 * may hold a keystroke that has not settled, and the forms keep one card in
 * state at a time.
 */

interface Props {
  cards: JudgeCard[];
  activeKey: string;
  onSelect: (key: string) => void;
  /** Card key → how many placings are filled in, for the progress pips. */
  filledByCard: Record<string, number>;
  /** Entries eligible to be placed, for "3 of 8". */
  total: number;
  disabled?: boolean;
}

export default function JudgeTabs({
  cards,
  activeKey,
  onSelect,
  filledByCard,
  total,
  disabled,
}: Props) {
  if (cards.length <= 1) return null;

  return (
    <div className="mb-4">
      <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#8b7355' }}>
        Judge&apos;s card
      </p>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Judge's card">
        {cards.map((card) => {
          const isActive = card.key === activeKey;
          const filled = filledByCard[card.key] ?? 0;
          const complete = total > 0 && filled === total;
          return (
            <button
              key={card.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              disabled={disabled}
              onClick={() => onSelect(card.key)}
              className="min-h-[44px] px-3 rounded-lg border text-left disabled:opacity-50"
              style={{
                borderColor: isActive ? '#8b4513' : '#d4b896',
                backgroundColor: isActive ? '#8b4513' : '#fffdf9',
                color: isActive ? '#ffffff' : '#2c1810',
                borderWidth: isActive ? 2 : 1,
              }}
            >
              <span className="block text-sm font-semibold leading-tight">
                {card.shortLabel} · {card.label}
              </span>
              <span
                className="block text-xs leading-tight"
                style={{ color: isActive ? '#f5ede0' : complete ? '#065f46' : '#8b7355' }}
              >
                {complete ? `✓ ${filled} of ${total}` : `${filled} of ${total} placed`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
