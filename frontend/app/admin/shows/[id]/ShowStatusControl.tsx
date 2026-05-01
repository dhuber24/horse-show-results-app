'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmDialog from '@/components/ConfirmDialog';

type ShowStatus = 'DRAFT' | 'PUBLISHED' | 'ACTIVE' | 'COMPLETED';

const STATUS_STYLES: Record<ShowStatus, { bg: string; text: string }> = {
  DRAFT:     { bg: '#f5ede0', text: '#8b7355' },
  PUBLISHED: { bg: '#fef3c7', text: '#92400e' },
  ACTIVE:    { bg: '#d1fae5', text: '#065f46' },
  COMPLETED: { bg: '#dbeafe', text: '#1e40af' },
};

const STATUS_TRANSITION_INFO: Partial<Record<ShowStatus, { label: string; targetStatus: ShowStatus; warning: string }>> = {
  DRAFT: {
    label: 'Publish Show',
    targetStatus: 'PUBLISHED',
    warning: 'Publishing makes this show visible to exhibitors so they can view classes and register entries. This cannot be undone.',
  },
  PUBLISHED: {
    label: 'Set to Active',
    targetStatus: 'ACTIVE',
    warning: 'Activating the show opens scoring for scorekeepers. This cannot be undone.',
  },
};

function getNextAction(status: ShowStatus): { label: string; targetStatus: ShowStatus; warning: string } | null {
  return STATUS_TRANSITION_INFO[status] ?? null;
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
            title={saving ? 'Saving, please wait…' : undefined}
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

      {pendingStatus && nextAction && (
        <ConfirmDialog
          title={`Change status to ${pendingStatus}?`}
          message={nextAction.warning}
          confirmLabel="Yes, confirm"
          confirming={saving}
          onConfirm={handleConfirm}
          onCancel={() => setPendingStatus(null)}
        />
      )}
    </div>
  );
}
