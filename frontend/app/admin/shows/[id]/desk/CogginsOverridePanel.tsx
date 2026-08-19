'use client';

import { useEffect, useState } from 'react';

interface CogginsOverride {
  id: string;
  horse_name: string;
  coggins_status: string;
  overridden_by_name: string | null;
  created_at: string;
}

/**
 * Historical record of the old Coggins entry gate.
 *
 * Health paperwork no longer blocks an entry, so nothing writes these rows any
 * more and this panel is empty for any show run since — but shows that ran
 * under the old rule keep their audit trail, which is why the component stays.
 * Current shortfalls live in `HealthFlagPanel`.
 */

/** Matches the COGGINS_* statuses in backend/routers/horse_documents.py. */
const STATUS_LABEL: Record<string, string> = {
  missing: 'No Coggins on file',
  undated: 'No expiration date recorded',
  expired: 'Coggins expired',
};

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function CogginsOverridePanel({ showId }: { showId: string }) {
  const [overrides, setOverrides] = useState<CogginsOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/shows/${showId}/coggins-overrides`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setOverrides(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [showId]);

  // Nothing to account for is the normal case — stay out of the way entirely
  // rather than adding an empty section to every show.
  if (loading || overrides.length === 0) return null;

  return (
    <section className="rounded-lg border p-4" style={{ borderColor: '#e8d5b7', backgroundColor: '#fffdf9' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm font-semibold"
        style={{ color: '#92400e' }}
      >
        <span>⚠ Coggins overrides — historical ({overrides.length})</span>
        <span className="text-xs font-normal">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <>
          <p className="text-xs mt-2" style={{ color: '#8b7355' }}>
            From when a lapsed Coggins blocked an entry outright: staff confirmed the paper
            document and recorded the bypass. Entry no longer waits on health records, so
            nothing is added here any more — outstanding paperwork is flagged above.
          </p>
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-xs uppercase tracking-wide" style={{ color: '#8b4513' }}>
                  <th className="text-left font-semibold pb-1 pr-3">Horse</th>
                  <th className="text-left font-semibold pb-1 pr-3">Was</th>
                  <th className="text-left font-semibold pb-1 pr-3">Overridden by</th>
                  <th className="text-left font-semibold pb-1">When</th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((o) => (
                  <tr key={o.id} className="border-t" style={{ borderColor: '#f0e6d6' }}>
                    <td className="py-1.5 pr-3" style={{ color: '#2c1810' }}>{o.horse_name}</td>
                    <td className="py-1.5 pr-3" style={{ color: '#8b7355' }}>
                      {STATUS_LABEL[o.coggins_status] ?? o.coggins_status}
                    </td>
                    <td className="py-1.5 pr-3" style={{ color: '#5a3e2b' }}>
                      {o.overridden_by_name ?? '(account removed)'}
                    </td>
                    <td className="py-1.5 whitespace-nowrap" style={{ color: '#8b7355' }} suppressHydrationWarning>
                      {formatWhen(o.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
