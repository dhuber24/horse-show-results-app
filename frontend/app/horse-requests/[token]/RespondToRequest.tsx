'use client';

import { useState } from 'react';
import Link from 'next/link';

export type HorseRequest = {
  kind: 'link' | 'transfer';
  status: string;
  horse_name: string;
  requested_by_name: string;
  approver_name: string;
  message: string | null;
  expires_at: string;
};

const OUTCOME_COPY: Record<string, string> = {
  approved: 'You already approved this request.',
  declined: 'You already declined this request.',
  cancelled: 'This request was withdrawn by the person who sent it.',
  expired: 'This request has expired. Ask them to send a new one.',
};

export default function RespondToRequest({
  token,
  request,
}: {
  token: string;
  request: HorseRequest;
}) {
  const [status, setStatus] = useState(request.status);
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isTransfer = request.kind === 'transfer';

  const respond = async (action: 'approve' | 'decline') => {
    setError(null);
    setBusy(action);
    try {
      const res = await fetch(`/api/horse-access-requests/by-token/${token}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(
          typeof json?.detail === 'string'
            ? json.detail
            : json?.detail?.message || 'Could not record your answer. Try again.',
        );
        setBusy(null);
        return;
      }
      setStatus(json.status);
      setBusy(null);
    } catch {
      setError('Network error — please try again.');
      setBusy(null);
    }
  };

  if (status !== 'pending') {
    const approvedNow = status === 'approved';
    return (
      <div
        className="rounded-lg border p-5"
        style={{
          borderColor: approvedNow ? 'var(--success-border)' : 'var(--border)',
          backgroundColor: approvedNow ? 'var(--success-bg)' : 'var(--background)',
        }}
      >
        <h1 className="text-xl font-bold" style={{ color: approvedNow ? 'var(--success-strong)' : 'var(--foreground)' }}>
          {approvedNow
            ? isTransfer
              ? `${request.horse_name} is yours`
              : `${request.requested_by_name} can now show ${request.horse_name}`
            : 'Nothing changed'}
        </h1>
        <p className="text-sm mt-2" style={{ color: approvedNow ? 'var(--success)' : 'var(--text-deep)' }}>
          {approvedNow
            ? isTransfer
              ? 'The horse is on your profile and you are the owner of record. Its documents and registrations came with it.'
              : 'The horse is on their profile so they can enter it in shows. You are still the owner of record.'
            : (OUTCOME_COPY[status] ?? 'This request is no longer open.')}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/profile?tab=horses"
            className="text-sm font-medium px-3 py-2 rounded"
            style={{ backgroundColor: 'var(--foreground)', color: 'var(--bg-subtle)' }}
          >
            Go to my horses
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-5" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
      <h1 className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>
        {isTransfer
          ? `${request.requested_by_name} wants to transfer ${request.horse_name} to you`
          : `${request.requested_by_name} wants to add ${request.horse_name} to their profile`}
      </h1>

      <p className="text-sm mt-3" style={{ color: 'var(--text-deep)' }}>
        {isTransfer ? (
          <>
            Accepting makes you the owner of record for <strong>{request.horse_name}</strong> and puts
            it on your profile, with its registrations and documents. {request.requested_by_name} keeps
            the horse visible in their own history but is no longer the owner.
          </>
        ) : (
          <>
            Approving puts <strong>{request.horse_name}</strong> on {request.requested_by_name}&rsquo;s
            profile so they can enter it in shows. You stay the owner of record, and you can remove
            their access later from your horse&rsquo;s page.
          </>
        )}
      </p>

      {request.message && (
        <blockquote
          className="mt-3 text-sm border-l-2 pl-3 py-1"
          style={{ borderColor: 'var(--border)', color: 'var(--text-deep)' }}
        >
          {request.message}
        </blockquote>
      )}

      <div className="flex flex-wrap gap-2 mt-5">
        <button
          onClick={() => respond('approve')}
          disabled={busy !== null}
          className="px-4 py-2 rounded font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: 'var(--success-strong)' }}
        >
          {busy === 'approve' ? 'Saving…' : isTransfer ? 'Accept the horse' : 'Approve'}
        </button>
        <button
          onClick={() => respond('decline')}
          disabled={busy !== null}
          className="px-4 py-2 rounded font-medium border disabled:opacity-50"
          style={{ borderColor: 'var(--border)', color: 'var(--text-deep)', backgroundColor: 'var(--surface)' }}
        >
          {busy === 'decline' ? 'Saving…' : 'Decline'}
        </button>
      </div>

      <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
        Nothing changes unless you choose. This link expires{' '}
        {new Date(request.expires_at).toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })}
        .
      </p>

      {error && (
        <div
          className="mt-4 rounded-lg border p-3 text-sm"
          style={{ backgroundColor: 'var(--error-bg)', borderColor: 'var(--error-border)', color: 'var(--error-strong)' }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
