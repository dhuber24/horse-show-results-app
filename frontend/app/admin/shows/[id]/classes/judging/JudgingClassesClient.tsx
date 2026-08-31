'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

export type ScoredClass = {
  id: string;
  class_number: string;
  class_name: string;
  class_date: string;
  score_type: string;
  judging_system_id: string | null;
};

export type JudgingSystemOption = {
  id: string;
  code: string;
  name: string;
  base_score: number | null;
  maneuver_min: number;
  maneuver_max: number;
  unit_label: string;
  unit_count: number | null;
  notes: string | null;
  penalties: { id: string; label: string; value: number | null }[];
};

const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  border: '#d4b896',
  borderSoft: '#f0e6d2',
  bg: '#fff',
} as const;

function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

export default function JudgingClassesClient({
  showId,
  classes,
  systems,
}: {
  showId: string;
  classes: ScoredClass[];
  systems: JudgingSystemOption[];
}) {
  const router = useRouter();
  const [assigned, setAssigned] = useState<Record<string, string>>(() =>
    Object.fromEntries(classes.map((c) => [c.id, c.judging_system_id ?? ''])),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byDay = useMemo(() => {
    const groups: Record<string, ScoredClass[]> = {};
    for (const c of classes) (groups[c.class_date] ??= []).push(c);
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [classes]);

  async function assign(classId: string, systemId: string) {
    const previous = assigned[classId] ?? '';
    setAssigned((prev) => ({ ...prev, [classId]: systemId }));
    setBusy(classId);
    setError(null);
    try {
      const res = await fetch(`/api/shows/${showId}/classes/${classId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ judging_system_id: systemId || null }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json?.detail || 'Failed to set the card for this class.');
        setAssigned((prev) => ({ ...prev, [classId]: previous }));
        return;
      }
      router.refresh();
    } catch {
      setError('Network error — nothing was changed.');
      setAssigned((prev) => ({ ...prev, [classId]: previous }));
    } finally {
      setBusy(null);
    }
  }

  if (systems.length === 0) {
    return (
      <div
        className="rounded border p-4 text-sm"
        style={{ borderColor: COLORS.border, color: COLORS.muted }}
      >
        No card shapes are loaded for this show type. Classes will be scored the
        way they always have been — the scribe types a total.
      </div>
    );
  }

  if (classes.length === 0) {
    return (
      <div
        className="rounded border p-4 text-sm"
        style={{ borderColor: COLORS.border, color: COLORS.muted }}
      >
        This show has no scored classes yet. Only pattern and timed classes are
        marked on a card — a rail class is placed, not scored.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error && (
        <p
          className="text-sm rounded px-3 py-2"
          style={{ backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5' }}
        >
          ⚠ {error}
        </p>
      )}

      {byDay.map(([day, dayClasses]) => (
        <section key={day} className="space-y-2">
          <h2 className="text-sm font-semibold" style={{ color: COLORS.text }}>
            {formatDay(day)}
          </h2>
          <ul
            className="rounded border divide-y"
            style={{ borderColor: COLORS.border }}
          >
            {dayClasses.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-3 flex-wrap p-3"
                style={{ borderColor: COLORS.borderSoft }}
              >
                <span className="font-medium" style={{ color: COLORS.text }}>
                  {c.class_number}
                </span>
                <span className="flex-1 min-w-[10rem]" style={{ color: COLORS.text }}>
                  {c.class_name}
                </span>
                <select
                  value={assigned[c.id] ?? ''}
                  onChange={(e) => void assign(c.id, e.target.value)}
                  disabled={busy === c.id}
                  className="min-h-[44px] border rounded-lg px-2 text-sm disabled:opacity-50"
                  style={{ borderColor: COLORS.border, color: COLORS.text }}
                >
                  <option value="">Scribe types a total</option>
                  {systems.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold" style={{ color: COLORS.text }}>
          What each card looks like
        </h2>
        {systems.map((s) => (
          <div
            key={s.id}
            className="rounded border p-3 text-xs space-y-1"
            style={{ borderColor: COLORS.borderSoft, color: COLORS.muted }}
          >
            <p className="font-semibold" style={{ color: COLORS.text }}>
              {s.name}
            </p>
            <p>
              {s.base_score != null && `Base ${s.base_score} · `}
              {s.unit_label.toLowerCase()}s scored {s.maneuver_min} to {s.maneuver_max}
              {s.unit_count != null && ` · ${s.unit_count} ${s.unit_label.toLowerCase()}s`}
              {s.penalties.length > 0 &&
                ` · penalties ${s.penalties
                  .map((p) => (p.value != null ? p.value : '—'))
                  .join(', ')}`}
            </p>
            {s.notes && <p>{s.notes}</p>}
          </div>
        ))}
      </section>
    </div>
  );
}
