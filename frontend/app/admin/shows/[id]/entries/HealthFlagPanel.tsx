'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type HealthStatus = 'valid' | 'missing' | 'undated' | 'expired';

interface HealthCheck {
  code: string;
  label: string;
  status: HealthStatus;
  message: string;
  expiry_date: string | null;
}

interface HealthFlag {
  horse_id: string;
  horse_name: string;
  barn_name: string | null;
  check: HealthCheck;
  entry_count: number;
  exhibitors: { exhibitor_id: string; exhibitor_name: string; back_number: number | null }[];
}

interface HealthFlags {
  show_id: string;
  as_of: string;
  flagged: HealthFlag[];
  totals: { horses: number; flagged: number; missing: number; undated: number; expired: number };
}

/** Short label for the flag chip. The full sentence is in `check.message`. */
const STATUS_LABEL: Record<string, string> = {
  missing: 'No Coggins',
  undated: 'No expiry date',
  expired: 'Not current',
};

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Horses entered in this show whose health paperwork will not carry them
 * through it.
 *
 * Nothing here blocks an entry — that is the point. Entry used to fail outright
 * on a lapsed Coggins, which meant the office met the problem at the desk with
 * the trailer already parked. This is the same information, early, while a
 * phone call still fixes it.
 */
export default function HealthFlagPanel({ showId }: { showId: string }) {
  const [data, setData] = useState<HealthFlags | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    fetch(`/api/shows/${showId}/health-flags`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setData(json && Array.isArray(json.flagged) ? json : null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [showId]);

  if (loading || !data) return null;

  // An all-clear is worth one quiet line: "no flags" and "nobody has entered
  // yet" look identical if the panel simply disappears.
  if (data.flagged.length === 0) {
    return (
      <section
        className="rounded-lg border p-3 text-sm"
        style={{ borderColor: '#bbf7d0', backgroundColor: '#f0fdf4', color: '#166534' }}
      >
        ✓ Health paperwork is current for all {data.totals.horses} entered horse
        {data.totals.horses === 1 ? '' : 's'} through {formatDate(data.as_of)}.
      </section>
    );
  }

  return (
    <section className="rounded-lg border p-4" style={{ borderColor: '#fca5a5', backgroundColor: '#fef7f5' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm font-semibold"
        style={{ color: '#991b1b' }}
      >
        <span>
          ⚠ {data.totals.flagged} horse{data.totals.flagged === 1 ? '' : 's'} need
          {data.totals.flagged === 1 ? 's' : ''} health records before the show
        </span>
        <span className="text-xs font-normal">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <>
          <p className="text-xs mt-2" style={{ color: '#7f1d1d' }}>
            These horses are entered and stay entered. Their Coggins does not cover the show
            through {formatDate(data.as_of)} — chase the exhibitor, or check the paper at the desk.
          </p>
          <ul className="mt-3 space-y-2">
            {data.flagged.map((flag) => (
              <li
                key={flag.horse_id}
                className="rounded border p-2.5 bg-white"
                style={{ borderColor: '#fecaca' }}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium" style={{ color: '#2c1810' }}>
                        {flag.horse_name}
                      </span>
                      {flag.barn_name && (
                        <span className="text-xs" style={{ color: '#8b7355' }}>
                          &ldquo;{flag.barn_name}&rdquo;
                        </span>
                      )}
                      <span
                        className="text-xs font-medium px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}
                      >
                        {STATUS_LABEL[flag.check.status] ?? flag.check.status}
                      </span>
                    </div>
                    <div className="text-xs mt-1" style={{ color: '#7f1d1d' }}>
                      {flag.check.message}
                      {flag.check.expiry_date && ` — on file through ${formatDate(flag.check.expiry_date)}`}
                    </div>
                    <div className="text-xs mt-1" style={{ color: '#8b7355' }}>
                      {flag.exhibitors
                        .map((e) => (e.back_number ? `#${e.back_number} ${e.exhibitor_name}` : e.exhibitor_name))
                        .join(', ')}
                      {' · '}
                      {flag.entry_count} class{flag.entry_count === 1 ? '' : 'es'}
                    </div>
                  </div>
                  <Link
                    href={`/admin/horses/${flag.horse_id}`}
                    className="shrink-0 text-xs font-medium hover:underline"
                    style={{ color: '#8b4513' }}
                  >
                    View horse →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
