'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type ShowStatus = 'DRAFT' | 'PUBLISHED' | 'ACTIVE' | 'COMPLETED';

const STATUS_STYLES: Record<ShowStatus, { bg: string; text: string }> = {
  DRAFT:     { bg: '#f5ede0', text: '#8b7355' },
  PUBLISHED: { bg: '#fef3c7', text: '#92400e' },
  ACTIVE:    { bg: '#d1fae5', text: '#065f46' },
  COMPLETED: { bg: '#dbeafe', text: '#1e40af' },
};

function getNextAction(status: ShowStatus): { label: string; targetStatus: ShowStatus } | null {
  if (status === 'DRAFT')     return { label: 'Publish Show',  targetStatus: 'PUBLISHED' };
  if (status === 'PUBLISHED') return { label: 'Set to Active', targetStatus: 'ACTIVE' };
  return null;
}

interface Props {
  showId: string;
  currentStatus: ShowStatus;
  classCount: number;
  endDate: string;
}

export default function ShowStatusControl({ showId, currentStatus, classCount, endDate }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<ShowStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const style = STATUS_STYLES[currentStatus] ?? STATUS_STYLES.DRAFT;
  const nextAction = getNextAction(currentStatus);

  const handleActionClick = () => {
    if (!nextAction) return;
    setError(null);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(endDate + 'T00:00:00');
    if (today > end) {
      setError("Cannot change status: the show's end date is in the past. Update the show dates first.");
      return;
    }

    if (nextAction.targetStatus === 'PUBLISHED' && classCount === 0) {
      setError('Cannot publish: the show must have at least one class before publishing.');
      return;
    }

    setPendingStatus(nextAction.targetStatus);
  };

  const handleConfirm = async () => {
    if (!pendingStatus) return;
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/shows/${showId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: pendingStatus }),
    });
    setSaving(false);
    setPendingStatus(null);
    if (res.ok) {
      router.refresh();
    } else {
      const json = await res.json().catch(() => ({}));
      setError(json?.detail ?? 'Failed to update status.');
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <span
          className="text-xs font-semibold px-2 py-1 rounded-full"
          style={{ backgroundColor: style.bg, color: style.text }}
        >
          {currentStatus}
        </span>

        {nextAction && (
          <button
            onClick={handleActionClick}
            disabled={saving}
            className="text-sm px-3 py-1 rounded font-medium border transition-colors hover:bg-amber-50"
            style={{ borderColor: '#8b4513', color: '#8b4513' }}
          >
            {nextAction.label}
          </button>
        )}
      </div>

      {error && (
        <p className="text-sm" style={{ color: '#dc2626' }}>{error}</p>
      )}

      {pendingStatus && (
        <div
          className="flex items-center gap-3 text-sm border rounded p-3"
          style={{ borderColor: '#d4b896', backgroundColor: '#fefce8' }}
        >
          <span style={{ color: '#2c1810' }}>
            Change status to <strong>{pendingStatus}</strong>?
          </span>
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="px-3 py-1 rounded text-white text-xs font-medium"
            style={{ backgroundColor: '#2c1810' }}
          >
            {saving ? 'Saving…' : 'Confirm'}
          </button>
          <button
            onClick={() => setPendingStatus(null)}
            disabled={saving}
            className="text-xs hover:underline"
            style={{ color: '#8b7355' }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
