'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import HighPointClassPoints from '@/components/HighPointClassPoints';
import { errorMessage } from '@/lib/api-error';
import type { HighPointClass } from '@/lib/high-point';

/**
 * Which classes count toward the show's high point (migration 167), and what
 * each puts up for grabs — every class, posted or not, beside its entries.
 *
 * A class left out keeps its placings and is posted like any other; it simply
 * adds nothing to the standings, here or in a circuit. Most shows leave every
 * class in, so the ticks start on and the office unticks the few that are not
 * part of its high point — a leadline, an open jackpot, a fun class.
 *
 * **One request at a time**, the pattern assignments' rule: every answer is the
 * whole class list, so two in flight could land out of order and put back a
 * tick already changed again. The controls hold while one is saving. Rendered
 * on the High Point page and in setup Step 8 beside the chart — one
 * implementation, two doors, like the chart itself.
 */
export default function HighPointClasses({
  showId,
  initialClasses,
}: {
  showId: string;
  initialClasses: HighPointClass[];
}) {
  const router = useRouter();
  const [classes, setClasses] = useState(initialClasses);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [division, setDivision] = useState('');

  const divisions = useMemo(
    () =>
      Array.from(new Set(classes.map((c) => c.division_name).filter((d): d is string => Boolean(d)))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [classes],
  );
  const counted = classes.filter((c) => c.eligible).length;

  async function setEligible(classIds: string[], eligible: boolean) {
    if (classIds.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shows/${showId}/high-point/classes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ class_ids: classIds, eligible }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorMessage(body, 'That change was not saved.'));
        return;
      }
      setClasses((body?.classes as HighPointClass[] | undefined) ?? classes);
      // The leaders and the standings elsewhere on the page move with it.
      router.refresh();
    } catch {
      setError('Network error — nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  if (classes.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        No classes yet. Once the schedule is built, every class counts toward high point unless you leave it out here.
      </p>
    );
  }

  const inDivision = classes.filter((c) => c.division_name === division).map((c) => c.class_id);

  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: 'var(--text-deep)' }}>
        <strong>{counted}</strong> of {classes.length} classes count toward high point. Untick a class to leave its
        placings out of the standings — it is still judged and posted as usual.
      </p>

      {divisions.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select
            value={division}
            onChange={(e) => setDivision(e.target.value)}
            disabled={busy}
            aria-label="Every class in a division"
            className="min-h-[36px] border rounded-lg px-2 text-sm disabled:opacity-50"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--foreground)' }}
          >
            <option value="">Every class in…</option>
            {divisions.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void setEligible(inDivision, true)}
            disabled={busy || !division}
            title={!division ? 'Choose a division first' : busy ? 'Saving, please wait…' : undefined}
            className="px-2.5 py-1 rounded border text-xs font-medium disabled:opacity-50"
            style={{ borderColor: 'var(--border)', color: 'var(--accent)', backgroundColor: 'var(--surface)' }}
          >
            Counts
          </button>
          <button
            type="button"
            onClick={() => void setEligible(inDivision, false)}
            disabled={busy || !division}
            title={!division ? 'Choose a division first' : busy ? 'Saving, please wait…' : undefined}
            className="px-2.5 py-1 rounded border text-xs font-medium disabled:opacity-50"
            style={{ borderColor: 'var(--border)', color: 'var(--accent)', backgroundColor: 'var(--surface)' }}
          >
            Doesn&apos;t count
          </button>
        </div>
      )}

      {error && (
        <p
          className="text-sm rounded px-3 py-2"
          style={{ backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)', border: '1px solid var(--error-border)' }}
        >
          ⚠ {error}
        </p>
      )}

      <HighPointClassPoints
        classes={classes}
        controlHeading="Counts"
        control={(cls) => (
          <input
            type="checkbox"
            checked={cls.eligible}
            disabled={busy}
            onChange={(e) => void setEligible([cls.class_id], e.target.checked)}
            aria-label={`Class ${cls.class_number} counts toward high point`}
            title={busy ? 'Saving, please wait…' : undefined}
          />
        )}
      />
    </div>
  );
}
