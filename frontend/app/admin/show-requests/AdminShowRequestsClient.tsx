'use client';

import { useState } from 'react';
import Link from 'next/link';

interface ShowRequest {
  id: string;
  requested_by_name: string | null;
  show_name: string;
  show_type_code: string | null;
  show_type_name: string | null;
  venue_name: string | null;
  start_date: string;
  end_date: string;
  manager_association_id: string | null;
  association_approval_confirmed: boolean;
  notes: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  admin_notes: string | null;
  created_show_id: string | null;
  created_at: string;
}

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  PENDING:  { bg: '#fffbeb', color: '#92400e', label: 'Pending' },
  APPROVED: { bg: '#f0fdf4', color: '#166534', label: 'Approved' },
  REJECTED: { bg: '#fef2f2', color: '#991b1b', label: 'Rejected' },
};

function formatDateRange(start: string, end: string) {
  const s = new Date(start + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const e = new Date(end + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return s === e ? s : `${s} – ${e}`;
}

export default function AdminShowRequestsClient({ initialRequests }: { initialRequests: ShowRequest[] }) {
  const [requests, setRequests] = useState<ShowRequest[]>(initialRequests);
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<'approve' | 'reject' | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'PENDING' | 'ALL'>('PENDING');

  const openAction = (id: string, type: 'approve' | 'reject') => {
    setActionId(id);
    setActionType(type);
    setAdminNotes('');
    setActionError(null);
  };

  const cancelAction = () => {
    setActionId(null);
    setActionType(null);
    setAdminNotes('');
    setActionError(null);
  };

  const submitAction = async () => {
    if (!actionId || !actionType) return;
    setSubmitting(true);
    setActionError(null);

    const res = await fetch(`/api/show-requests/${actionId}/${actionType}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_notes: adminNotes || null }),
    });

    if (res.ok) {
      const updated = await res.json();
      setRequests(prev => prev.map(r => r.id === actionId ? updated : r));
      cancelAction();
    } else {
      const data = await res.json().catch(() => ({}));
      setActionError(data.detail || data.error || 'Action failed.');
    }
    setSubmitting(false);
  };

  const filtered = filter === 'PENDING' ? requests.filter(r => r.status === 'PENDING') : requests;
  const pendingCount = requests.filter(r => r.status === 'PENDING').length;

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center">
        <button
          onClick={() => setFilter('PENDING')}
          className="text-sm px-3 py-1.5 rounded-full font-medium transition"
          style={{
            backgroundColor: filter === 'PENDING' ? '#8b4513' : '#f5ede0',
            color: filter === 'PENDING' ? '#ffffff' : '#5a3e2b',
          }}
        >
          Pending
          {pendingCount > 0 && (
            <span
              className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full"
              style={{
                backgroundColor: filter === 'PENDING' ? 'rgba(255,255,255,0.25)' : '#8b4513',
                color: filter === 'PENDING' ? '#ffffff' : '#ffffff',
              }}
            >
              {pendingCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setFilter('ALL')}
          className="text-sm px-3 py-1.5 rounded-full font-medium transition"
          style={{
            backgroundColor: filter === 'ALL' ? '#8b4513' : '#f5ede0',
            color: filter === 'ALL' ? '#ffffff' : '#5a3e2b',
          }}
        >
          All requests
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm py-6 text-center" style={{ color: '#8b7355' }}>
          {filter === 'PENDING' ? 'No pending show requests.' : 'No show requests found.'}
        </p>
      ) : (
        <div className="space-y-4">
          {filtered.map(req => {
            const style = STATUS_STYLES[req.status] ?? STATUS_STYLES.PENDING;
            const isActing = actionId === req.id;

            return (
              <div
                key={req.id}
                className="rounded-lg border p-5"
                style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="font-semibold" style={{ color: '#2c1810' }}>{req.show_name}</p>
                    <p className="text-sm mt-0.5" style={{ color: '#5a3e2b' }}>
                      Submitted by <span className="font-medium">{req.requested_by_name ?? '—'}</span>
                    </p>
                  </div>
                  <span
                    className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: style.bg, color: style.color }}
                  >
                    {style.label}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm mb-3">
                  <div>
                    <span className="text-xs font-medium uppercase tracking-wide" style={{ color: '#8b7355' }}>Association</span>
                    <p style={{ color: '#2c1810' }}>{req.show_type_name ?? '—'} {req.show_type_code ? `(${req.show_type_code})` : ''}</p>
                  </div>
                  <div>
                    <span className="text-xs font-medium uppercase tracking-wide" style={{ color: '#8b7355' }}>Venue</span>
                    <p style={{ color: '#2c1810' }}>{req.venue_name ?? 'Not specified'}</p>
                  </div>
                  <div>
                    <span className="text-xs font-medium uppercase tracking-wide" style={{ color: '#8b7355' }}>Dates</span>
                    <p style={{ color: '#2c1810' }}>{formatDateRange(req.start_date, req.end_date)}</p>
                  </div>
                  <div>
                    <span className="text-xs font-medium uppercase tracking-wide" style={{ color: '#8b7355' }}>Manager ID</span>
                    <p style={{ color: '#2c1810' }}>{req.manager_association_id ?? 'Not provided'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <span
                    className="text-xs font-medium px-2 py-0.5 rounded"
                    style={{
                      backgroundColor: req.association_approval_confirmed ? '#f0fdf4' : '#fef2f2',
                      color: req.association_approval_confirmed ? '#166534' : '#991b1b',
                    }}
                  >
                    {req.association_approval_confirmed
                      ? '✓ Association approval confirmed'
                      : '✗ Association approval NOT confirmed'}
                  </span>
                </div>

                {req.notes && (
                  <div className="mb-3 text-sm p-3 rounded" style={{ backgroundColor: '#faf7f2', color: '#5a3e2b' }}>
                    <span className="font-medium">Notes: </span>{req.notes}
                  </div>
                )}

                {req.status === 'APPROVED' && req.created_show_id && (
                  <Link
                    href={`/admin/shows/${req.created_show_id}`}
                    className="text-sm font-medium hover:underline"
                    style={{ color: '#8b4513' }}
                  >
                    View created show →
                  </Link>
                )}

                {req.status === 'REJECTED' && req.admin_notes && (
                  <p className="text-xs" style={{ color: '#991b1b' }}>
                    <span className="font-medium">Rejection reason: </span>{req.admin_notes}
                  </p>
                )}

                {req.status === 'PENDING' && !isActing && (
                  <div className="flex gap-2 mt-3 pt-3 border-t" style={{ borderColor: '#f0e6d3' }}>
                    <button
                      onClick={() => openAction(req.id, 'approve')}
                      className="text-sm font-medium px-3 py-1.5 rounded hover:opacity-90 transition"
                      style={{ backgroundColor: '#166534', color: '#ffffff' }}
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => openAction(req.id, 'reject')}
                      className="text-sm font-medium px-3 py-1.5 rounded hover:opacity-90 transition"
                      style={{ backgroundColor: '#991b1b', color: '#ffffff' }}
                    >
                      Reject
                    </button>
                  </div>
                )}

                {isActing && (
                  <div className="mt-3 pt-3 border-t space-y-3" style={{ borderColor: '#f0e6d3' }}>
                    <p className="text-sm font-medium" style={{ color: '#2c1810' }}>
                      {actionType === 'approve' ? 'Approve this show request?' : 'Reject this show request?'}
                    </p>
                    {actionType === 'approve' && (
                      <p className="text-xs" style={{ color: '#5a3e2b' }}>
                        This will automatically create a DRAFT show and assign the Show Manager to it.
                      </p>
                    )}
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: '#5a3e2b' }}>
                        {actionType === 'reject' ? 'Reason for rejection (recommended)' : 'Notes (optional)'}
                      </label>
                      <textarea
                        rows={2}
                        value={adminNotes}
                        onChange={e => setAdminNotes(e.target.value)}
                        placeholder={actionType === 'reject' ? 'Explain why this request is being rejected…' : 'Any notes for the manager…'}
                        className="w-full border rounded px-3 py-2 text-sm focus:outline-none resize-none"
                        style={{ borderColor: '#d4b896' }}
                      />
                    </div>
                    {actionError && (
                      <p className="text-xs text-red-600">{actionError}</p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={submitAction}
                        disabled={submitting}
                        className="text-sm font-medium px-3 py-1.5 rounded disabled:opacity-50"
                        style={{
                          backgroundColor: actionType === 'approve' ? '#166534' : '#991b1b',
                          color: '#ffffff',
                        }}
                      >
                        {submitting ? 'Processing…' : `Yes, ${actionType}`}
                      </button>
                      <button
                        onClick={cancelAction}
                        disabled={submitting}
                        className="text-sm hover:underline disabled:opacity-50"
                        style={{ color: '#8b7355' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
