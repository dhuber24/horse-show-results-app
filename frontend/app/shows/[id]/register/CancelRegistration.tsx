'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { CancellationWindow } from './types';

/**
 * Getting back out of a show.
 *
 * An exhibitor may call off their own registration up to a fortnight before the
 * show. Inside that window it is the show office's to do — by then the stall
 * chart is drawn, the entries are in the program, and what happens to money
 * already paid is a decision the person leaving does not get to make alone.
 *
 * Two states, and the closed one is a **destination, not a disabled button**:
 * it says who to ask and links straight to them. A greyed-out control with a
 * tooltip is how somebody ends up ringing round to find out whether they are
 * still entered.
 *
 * Inline confirmation rather than a modal, and the confirm step spells out what
 * goes — this drops every class, stall, camping night, side pot and futurity
 * entry at once, which is a good deal more than the per-class Remove beside it.
 */
export default function CancelRegistration({
  showId,
  window: cancellation,
  entryCount,
}: {
  showId: string;
  window: CancellationWindow;
  entryCount: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deadlineText = cancellation.deadline
    ? new Date(`${cancellation.deadline}T00:00:00`).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  const handleCancel = async () => {
    setWorking(true);
    setError(null);
    try {
      const res = await fetch(`/api/shows/${showId}/register/signup`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data?.detail?.message ||
            (typeof data?.detail === 'string' ? data.detail : null) ||
            'Could not cancel your registration.',
        );
        setWorking(false);
        return;
      }
      // Straight to the show menu: staying here would re-render the
      // registration screen for a show they are no longer in.
      router.push(`/shows/${showId}`);
      router.refresh();
    } catch {
      setError('Network error — please try again.');
      setWorking(false);
    }
  };

  if (!cancellation.self_service) {
    return (
      <section
        className="mt-4 rounded-lg border p-4 text-sm"
        style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}
      >
        <h2 className="text-sm font-semibold mb-1" style={{ color: '#2c1810' }}>
          Need to withdraw from this show?
        </h2>
        <p style={{ color: '#5d4a37' }}>
          {typeof cancellation.days_until_show === 'number' && cancellation.days_until_show >= 0
            ? `The show starts in ${cancellation.days_until_show} ${
                cancellation.days_until_show === 1 ? 'day' : 'days'
              }. `
            : ''}
          Inside {cancellation.notice_days} days the show office cancels a registration for you —
          message them and they will take you off.
        </p>
        <Link
          href={`/shows/${showId}/contact`}
          className="inline-block mt-2 font-medium hover:underline"
          style={{ color: '#8b4513' }}
        >
          Message the show office →
        </Link>
      </section>
    );
  }

  return (
    <section
      className="mt-4 rounded-lg border p-4"
      style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}
    >
      <h2 className="text-sm font-semibold" style={{ color: '#2c1810' }}>
        Cancel my registration
      </h2>
      <p className="text-sm mt-1" style={{ color: '#5d4a37' }}>
        {deadlineText
          ? `You can cancel yourself until ${deadlineText}. After that the show office has to do it.`
          : 'You can cancel yourself while the show is more than two weeks away.'}
      </p>

      {error && (
        <div
          className="mt-3 rounded-lg border p-3 text-sm"
          style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }}
        >
          {error}
        </div>
      )}

      {confirming ? (
        <div className="mt-3 space-y-3">
          <div
            className="rounded-lg border p-3 text-sm"
            style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }}
          >
            This drops{' '}
            {entryCount > 0
              ? `all ${entryCount} class ${entryCount === 1 ? 'entry' : 'entries'}, `
              : ''}
            your stalls, shavings and camping, and any side pot or futurity entries at this show.
            Anything you have already paid stays on your account for the office to refund.
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: '#5d4a37' }}>
              Reason (optional — the show office sees this)
            </label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              className="w-full px-3 py-2 rounded border text-sm"
              style={{ borderColor: '#d4b896', backgroundColor: '#ffffff', color: '#2c1810' }}
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCancel}
              disabled={working}
              className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: '#b91c1c' }}
            >
              {working ? 'Cancelling…' : 'Yes, cancel my registration'}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
              disabled={working}
              className="text-sm hover:underline disabled:opacity-50"
              style={{ color: '#8b7355' }}
            >
              Keep my registration
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-3 px-4 py-2 rounded border text-sm font-medium"
          style={{ borderColor: '#b91c1c', color: '#b91c1c', backgroundColor: '#ffffff' }}
        >
          Cancel my registration
        </button>
      )}
    </section>
  );
}
