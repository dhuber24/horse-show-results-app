'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const STATUSES = ['DRAFT', 'PUBLISHED', 'ACTIVE', 'COMPLETED'] as const;

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  DRAFT: { bg: '#f5ede0', text: '#8b7355' },
  PUBLISHED: { bg: '#fef3c7', text: '#92400e' },
  ACTIVE: { bg: '#d1fae5', text: '#065f46' },
  COMPLETED: { bg: '#dbeafe', text: '#1e40af' },
};

export default function ShowStatusControl({ showId, currentStatus }: { showId: string; currentStatus: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const handleChange = async (newStatus: string) => {
    if (newStatus === currentStatus) return;
    setSaving(true);
    const res = await fetch(`/api/shows/${showId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    setSaving(false);
    if (res.ok) {
      router.refresh();
    }
  };

  const style = STATUS_STYLES[currentStatus] ?? STATUS_STYLES.DRAFT;

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-semibold px-2 py-1 rounded-full" style={{ backgroundColor: style.bg, color: style.text }}>
        {currentStatus}
      </span>
      <select
        value={currentStatus}
        onChange={(e) => handleChange(e.target.value)}
        disabled={saving}
        className="text-sm border rounded px-2 py-1"
        style={{ borderColor: '#d4b896', color: '#2c1810' }}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
    </div>
  );
}
