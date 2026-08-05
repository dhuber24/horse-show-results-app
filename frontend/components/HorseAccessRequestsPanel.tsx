'use client';

import { useCallback, useEffect, useState } from 'react';
import ApprovalLinkCallout from './ApprovalLinkCallout';

export type HorseAccessRequest = {
  id: string;
  kind: 'link' | 'transfer';
  status: string;
  horse_id: string;
  horse_name: string;
  requested_by_name: string;
  approver_name: string;
  approver_email: string | null;
  message: string | null;
  email_sent: boolean | null;
  expires_at: string;
  created_at: string | null;
  is_mine_to_approve: boolean;
  /** Only present on requests you sent, so the link survives closing the page
   *  you first saw it on. */
  approval_url: string | null;
};

/**
 * Pending horse-access requests in both directions.
 *
 * Requests you *sent* are listed so you can chase or cancel them. Requests
 * waiting on *you* are listed because the email may not have arrived — the app
 * has to be a place you can find them, not just a thing that sends mail.
 * Deciding still happens on the token page, which is the one code path for it.
 */
export default function HorseAccessRequestsPanel({
  refreshKey = 0,
  onChanged,
}: {
  refreshKey?: number;
  onChanged?: () => void;
}) {
  const [requests, setRequests] = useState<HorseAccessRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [linkShownId, setLinkShownId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/horse-access-requests?status=pending')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setRequests(Array.isArray(rows) ? rows : []))
      .catch(() => setRequests([]))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const cancel = async (id: string) => {
    setCancellingId(id);
    const res = await fetch(`/api/horse-access-requests/${id}`, { method: 'DELETE' });
    setCancellingId(null);
    setConfirmCancelId(null);
    if (res.ok || res.status === 204) {
      setRequests((prev) => prev.filter((r) => r.id !== id));
      onChanged?.();
    }
  };

  const respond = async (id: string, action: 'approve' | 'decline') => {
    setError(null);
    setRespondingId(id);
    const res = await fetch(`/api/horse-access-requests/${id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    setRespondingId(null);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(
        typeof json?.detail === 'string' ? json.detail : 'Could not record your answer. Try again.',
      );
      return;
    }
    setRequests((prev) => prev.filter((r) => r.id !== id));
    onChanged?.();
  };

  if (!loaded || requests.length === 0) return null;

  const waitingOnMe = requests.filter((r) => r.is_mine_to_approve);
  const sentByMe = requests.filter((r) => !r.is_mine_to_approve);

  return (
    <div className="space-y-3">
      {error && (
        <div
          className="rounded border p-2 text-xs"
          style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }}
        >
          {error}
        </div>
      )}
      {waitingOnMe.length > 0 && (
        <section
          className="rounded-lg border p-3"
          style={{ borderColor: '#fde68a', backgroundColor: '#fffbeb' }}
        >
          <h3 className="text-sm font-semibold" style={{ color: '#92400e' }}>
            Waiting on you
          </h3>
          <ul className="mt-2 space-y-2">
            {waitingOnMe.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs" style={{ color: '#92400e' }}>
                  {r.kind === 'transfer'
                    ? `${r.requested_by_name} is transferring ${r.horse_name} to you`
                    : `${r.requested_by_name} wants to add ${r.horse_name} to their profile`}
                </span>
                {/* Decided in place rather than via the emailed token: being
                    signed in as the approver is at least as strong a claim as
                    holding the link, and the email may never have arrived. */}
                <span className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => respond(r.id, 'approve')}
                    disabled={respondingId === r.id}
                    className="text-xs font-medium px-2.5 py-1 rounded disabled:opacity-50"
                    style={{ backgroundColor: '#166534', color: '#f0fdf4' }}
                  >
                    {respondingId === r.id ? 'Saving…' : r.kind === 'transfer' ? 'Accept' : 'Approve'}
                  </button>
                  <button
                    onClick={() => respond(r.id, 'decline')}
                    disabled={respondingId === r.id}
                    className="text-xs hover:underline disabled:opacity-50"
                    style={{ color: '#92400e' }}
                  >
                    Decline
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sentByMe.length > 0 && (
        <section
          className="rounded-lg border p-3"
          style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}
        >
          <h3 className="text-sm font-semibold" style={{ color: '#2c1810' }}>
            Waiting on someone else
          </h3>
          <ul className="mt-2 space-y-2">
            {sentByMe.map((r) => (
              <li key={r.id} className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs" style={{ color: '#5d4a37' }}>
                  {r.kind === 'transfer'
                    ? `${r.horse_name} → ${r.approver_name}`
                    : `${r.horse_name} · asked ${r.approver_name}`}
                  {r.email_sent === false && (
                    <span style={{ color: '#b45309' }}> · email didn&apos;t send</span>
                  )}
                </span>
                {confirmCancelId === r.id ? (
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="text-xs" style={{ color: '#5d4a37' }}>Cancel it?</span>
                    <button
                      onClick={() => cancel(r.id)}
                      disabled={cancellingId === r.id}
                      className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                    >
                      {cancellingId === r.id ? 'Cancelling…' : 'Yes'}
                    </button>
                    <button
                      onClick={() => setConfirmCancelId(null)}
                      className="text-xs hover:underline"
                      style={{ color: '#8b7355' }}
                    >
                      Keep
                    </button>
                  </span>
                ) : (
                  <span className="flex items-center gap-3 shrink-0">
                    {r.approval_url && (
                      <button
                        onClick={() => setLinkShownId(linkShownId === r.id ? null : r.id)}
                        className="text-xs font-medium hover:underline"
                        style={{ color: '#8b4513' }}
                      >
                        {linkShownId === r.id ? 'Hide link' : 'Show link'}
                      </button>
                    )}
                    <button
                      onClick={() => setConfirmCancelId(r.id)}
                      className="text-xs hover:underline"
                      style={{ color: '#8b7355' }}
                    >
                      Cancel request
                    </button>
                  </span>
                )}
                </div>
                {linkShownId === r.id && r.approval_url && (
                  <ApprovalLinkCallout
                    url={r.approval_url}
                    emailSent={r.email_sent}
                    approverName={r.approver_name}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
