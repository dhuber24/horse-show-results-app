'use client';

import type { Chip } from '@/lib/subscriptions';

export function Chips({ chips }: { chips: Chip[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {chips.map((chip) => (
        <span
          key={chip.label}
          className="text-xs px-1.5 py-0.5 rounded font-medium"
          style={
            chip.urgent
              ? { backgroundColor: 'var(--warning-bg)', color: 'var(--warning-strong)' }
              : { backgroundColor: 'var(--bg-subtle)', color: 'var(--text-deep)' }
          }
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
}

export type Count<K extends string> = { key: K; label: string; count: number };

/** The counts along the top of a list, each a filter. */
export function CountFilters<K extends string>({
  counts,
  active,
  onChoose,
}: {
  counts: Count<K>[];
  active: K;
  onChoose: (key: K) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {counts.map(({ key, label, count }) => {
        const on = active === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            onClick={() => onChoose(key)}
            className="text-sm px-3 py-1.5 rounded border"
            style={{
              borderColor: on ? 'var(--accent-border)' : 'var(--border)',
              backgroundColor: on ? 'var(--accent-bg)' : 'var(--surface)',
              color: on ? 'var(--accent)' : 'var(--text-deep)',
            }}
          >
            {label} <span className="font-semibold tabular-nums">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
