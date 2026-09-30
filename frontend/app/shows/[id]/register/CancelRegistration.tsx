'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { CancellationWindow } from './types';

/**
 * Getting back out of a show.
 *
 * An exhibitor may call off their own registration while registration is open,
 * up to the cut-off the show company chose on My Company (migration 157) — 0
 * days is until the show starts. Past it, and always once the show is running,
 * it is the show office's to do, from the desk (`cancellations.may_self_cancel`).
 * Money already paid is not the leaver's to decide either way, which is why it
 * stays on the account as a credit for the office.
 *
 * Two states, and the closed one is a **destination, not a disabled button**:
 * it says who to ask and links straight to them. A greyed-out control with a
 * tooltip is how somebody ends up ringing round to find out whether they are
 * still entered.
 *
 * Inline confirmation rather than a modal, and the confirm step spells out what
 * goes — this drops every class, stall, camping night, side pot and futurity
 * entry at once, which is a good deal more than the per-class Remove beside it,
 * and the show leaves My Shows (`my_shows.withdrawn`).
 */
export default function CancelRegistration({
  showId,
  window: cancellation,
  entryCount,
  offersLodging = true,
}: {
  showId: string;
  window: CancellationWindow;
  entryCount: number;
  /** Whether the show sells stalls, shavings or camping — the confirm step
   *  does not mention them at a show that sells none. */
  offersLodging?: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cutOff = cancellation.days_before ?? 0;
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
      // Straight to the show menu, whose banner says the registration was
      // cancelled: staying here would re-render the registration screen for a
      // show they are no longer in, and My Shows no longer lists it at all.
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
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}
      >
        <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--foreground)' }}>
          Need to withdraw from this show?
        </h2>
        <p style={{ color: 'var(--text-deep)' }}>
          {cutOff > 0 && (cancellation.days_until_show ?? 0) > 0
            ? `Within ${cutOff} ${cutOff === 1 ? 'day' : 'days'} of the show, the show office cancels a registration for you`
            : 'The show is under way, so the show office cancels a registration now'}{' '}
          — message them and they will take you off.
        </p>
        <Link
          href={`/shows/${showId}/contact`}
          className="inline-block mt-2 font-medium hover:underline"
          style={{ color: 'var(--accent)' }}
        >
          Message the show office →
        </Link>
      </section>
    );
  }

  return (
    <section
      className="mt-4 rounded-lg border p-4"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}
    >
      <h2 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
        Cancel my registration
      </h2>
      <p className="text-sm mt-1" style={{ color: 'var(--text-deep)' }}>
        {cutOff > 0 && deadlineText
          ? `You can cancel yourself until ${deadlineText}, ${cutOff} ${cutOff === 1 ? 'day' : 'days'} before the show. After that the show office does it.`
          : 'You can cancel yourself until the show starts. Once it’s under way, the show office does it.'}
      </p>

      {error && (
        <div
          className="mt-3 rounded-lg border p-3 text-sm"
          style={{ backgroundColor: 'var(--error-bg)', borderColor: 'var(--error-border)', color: 'var(--error-strong)' }}
        >
          {error}
        </div>
      )}

      {confirming ? (
        <div className="mt-3 space-y-3">
          <div
            className="rounded-lg border p-3 text-sm"
            style={{ backgroundColor: 'var(--error-bg)', borderColor: 'var(--error-border)', color: 'var(--error-strong)' }}
          >
            This drops{' '}
            {entryCount > 0
              ? `all ${entryCount} class ${entryCount === 1 ? 'entry' : 'entries'}, `
              : ''}
            {offersLodging ? 'your stalls, shavings and camping, and ' : ''}any side pot or
            futurity entries at this show, and takes the show off My Shows. Anything you have already paid stays on your account
            for the office to refund.
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-deep)' }}>
              Reason (optional — the show office sees this)
            </label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              className="w-full px-3 py-2 rounded border text-sm"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--foreground)' }}
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCancel}
              disabled={working}
              className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--error)' }}
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
              style={{ color: 'var(--muted)' }}
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
          style={{ borderColor: 'var(--error)', color: 'var(--error)', backgroundColor: 'var(--surface)' }}
        >
          Cancel my registration
        </button>
      )}
    </section>
  );
}
