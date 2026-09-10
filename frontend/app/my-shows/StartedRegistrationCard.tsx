'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatDateRange, type StartedRegistration } from '@/lib/my-shows';

/**
 * A show they started registering for and walked away from.
 *
 * Deliberately not shaped like the bill cards below it. There is no
 * `show_entries` row behind this, so there is nothing owed, no back number and
 * no classes — a card with the same chrome and every figure at zero would read
 * as a completed registration that cost nothing. What it has instead is the one
 * thing that matters: which step they stopped on, and a button back into it.
 *
 * **The dismiss is not decoration.** The bookmark is written when the
 * registration screen opens, which means somebody who clicked Register to see
 * what the classes cost and decided against the show gets one too. Without a
 * way to say so, My Shows slowly fills with shows they are not entering, and a
 * list nobody trusts is one nobody reads. It deletes the row rather than
 * marking it — opening the form again is somebody changing their mind, and the
 * honest answer then is to bookmark it again.
 */
export default function StartedRegistrationCard({ show }: { show: StartedRegistration }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDismiss = async () => {
    setDismissing(true);
    setError(null);
    try {
      const res = await fetch(`/api/shows/${show.show_id}/register/draft`, { method: 'DELETE' });
      if (res.status !== 204 && !res.ok) {
        setError('Could not remove this — please try again.');
        setDismissing(false);
        return;
      }
      router.refresh();
    } catch {
      setError('Network error — please try again.');
      setDismissing(false);
    }
  };

  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)' }}
    >
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              href={`/shows/${show.show_id}`}
              className="font-semibold hover:underline leading-snug block"
              style={{ color: 'var(--foreground)' }}
            >
              {show.show_name}
            </Link>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
              {formatDateRange(show.start_date, show.end_date)}
              {show.venue && <> · {show.venue}</>}
            </p>
          </div>
          <span
            className="text-xs px-2 py-0.5 rounded font-medium shrink-0 mt-0.5"
            style={{ backgroundColor: 'var(--warning-border)', color: 'var(--warning-strong)' }}
          >
            Not finished
          </span>
        </div>

        <p className="text-sm mt-2" style={{ color: 'var(--warning-strong)' }}>
          You started registering and did not finish. Next up: {show.next_step_label.toLowerCase()}.
        </p>
        {/* Named, not counted. "Still needs your date of birth" is something
            somebody can act on from this card; "2 items outstanding" is
            something they have to open the form to find out. */}
        {show.still_needed.length > 0 && (
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
            Still needed: {show.still_needed.map((s) => s.toLowerCase()).join(', ')}.
          </p>
        )}
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
          You are not entered until you sign up — nothing is reserved and nothing is owed yet.
        </p>

        {error && (
          <p className="text-xs mt-2" style={{ color: 'var(--error-strong)' }}>
            {error}
          </p>
        )}

        <div
          className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t"
          style={{ borderColor: 'var(--warning-border)' }}
        >
          <Link
            href={`/shows/${show.show_id}/register`}
            className="text-xs font-medium px-2.5 py-1 rounded"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}
          >
            Finish registering
          </Link>
          <Link
            href={`/shows/${show.show_id}/details`}
            className="text-xs font-medium px-2.5 py-1 rounded border"
            style={{ borderColor: 'var(--border)', color: 'var(--text-deep)', backgroundColor: 'var(--surface)' }}
          >
            Show details
          </Link>

          {/* Inline confirmation rather than a modal, the same as every other
              destructive control in this app — and it is worth confirming:
              the row is deleted, so a mis-tap on a phone silently loses the
              only reminder they have that this show is half-done. */}
          {confirming ? (
            <span className="inline-flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={handleDismiss}
                disabled={dismissing}
                className="text-xs font-medium px-2 py-1 rounded text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--error)' }}
              >
                {dismissing ? 'Removing…' : 'Yes, remove'}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={dismissing}
                className="text-xs hover:underline"
                style={{ color: 'var(--muted)' }}
              >
                Keep it
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="text-xs hover:underline ml-auto"
              style={{ color: 'var(--muted)' }}
              title="Remove this from My Shows. Opening the registration screen again will bring it back."
            >
              Not entering this show
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
