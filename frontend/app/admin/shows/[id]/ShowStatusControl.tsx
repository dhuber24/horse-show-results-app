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

const STATUS_OPTIONS: { value: ShowStatus; label: string; warning: string }[] = [
  {
    value: 'DRAFT',
    label: 'Draft',
    warning: 'Reverting to Draft hides the show from exhibitors and allows deletion. Existing classes, entries, and results are preserved.',
  },
  {
    value: 'PUBLISHED',
    label: 'Published',
    warning: 'Publishing makes this show visible to exhibitors so they can view classes and register entries.',
  },
  {
    value: 'ACTIVE',
    label: 'In Progress',
    warning: 'Activating the show opens scoring for scorekeepers.',
  },
  {
    value: 'COMPLETED',
    label: 'Completed',
    warning: 'Marking the show Completed closes scoring. Results remain visible.',
  },
];

function extractErrorMessage(json: any, fallback: string): string {
  const detail = json?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const msgs = detail.map((d) => (typeof d?.msg === 'string' ? d.msg : null)).filter(Boolean);
    if (msgs.length) return msgs.join('; ');
  }
  return fallback;
}

function preflightCheck(
  target: ShowStatus,
  classCount: number,
  venueId: string | null,
  startDate: string,
  endDate: string,
): string | null {
  if (target === 'PUBLISHED') {
    if (!venueId) return 'Cannot publish: a venue must be selected before publishing.';
    if (classCount === 0) return 'Cannot publish: the show must have at least one class before publishing.';
  }
  if (target === 'ACTIVE') {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    if (today < start || today > end) {
      return "Cannot set to In Progress: the current date is outside the show's date range.";
    }
  }
  return null;
}

interface Props {
  showId: string;
  currentStatus: ShowStatus;
  classCount: number;
  startDate: string;
  endDate: string;
  venueId: string | null;
}

export default function ShowStatusControl({ showId, currentStatus, classCount, startDate, endDate, venueId }: Props) {
  const router = useRouter();
  const [targetStatus, setTargetStatus] = useState<ShowStatus | ''>('');
  const [pendingStatus, setPendingStatus] = useState<ShowStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const style = STATUS_STYLES[currentStatus] ?? STATUS_STYLES.DRAFT;

  const handleApply = () => {
    setError(null);
    if (!targetStatus || targetStatus === currentStatus) return;
    const err = preflightCheck(targetStatus, classCount, venueId, startDate, endDate);
    if (err) {
      setError(err);
      return;
    }
    setPendingStatus(targetStatus);
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
      setTargetStatus('');
      router.refresh();
    } else {
      const json = await res.json().catch(() => ({}));
      setError(extractErrorMessage(json, 'Failed to update status.'));
    }
  };

  const pendingOption = pendingStatus ? STATUS_OPTIONS.find((o) => o.value === pendingStatus) : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <span
          className="text-xs font-semibold px-2 py-1 rounded-full"
          style={{ backgroundColor: style.bg, color: style.text }}
        >
          {currentStatus}
        </span>

        <label className="text-sm flex items-center gap-2" style={{ color: '#8b7355' }}>
          Change to:
          <select
            value={targetStatus}
            onChange={(e) => { setTargetStatus(e.target.value as ShowStatus | ''); setError(null); }}
            disabled={saving}
            className="border rounded px-2 py-1 text-sm"
            style={{ borderColor: '#d4b896', color: '#2c1810' }}
          >
            <option value="">Select status…</option>
            {STATUS_OPTIONS
              .filter((o) => o.value !== currentStatus)
              .map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
          </select>
        </label>

        <button
          onClick={handleApply}
          disabled={saving || !targetStatus || targetStatus === currentStatus}
          title={!targetStatus ? 'Select a target status first.' : saving ? 'Saving, please wait…' : undefined}
          className="text-sm px-3 py-1 rounded font-medium border transition-colors hover:bg-amber-50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          style={{ borderColor: '#8b4513', color: '#8b4513' }}
        >
          Apply
        </button>
      </div>

      {error && (
        <p className="text-sm" style={{ color: '#dc2626' }}>{error}</p>
      )}

      {pendingStatus && pendingOption && (
        <ConfirmDialog
          title={`Change status to ${pendingOption.label}?`}
          message={pendingOption.warning}
          confirmLabel="Yes, confirm"
          confirming={saving}
          onConfirm={handleConfirm}
          onCancel={() => setPendingStatus(null)}
        />
      )}
    </div>
  );
}
