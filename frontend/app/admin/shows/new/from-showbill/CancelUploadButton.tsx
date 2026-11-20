'use client';

import { useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import { errorMessage } from '@/lib/api-error';

/**
 * Cancel a show bill upload that has not become a show -- reading, ready to
 * create, or failed. The backend deletes it with its documents
 * (`DELETE /show-bill-imports/{id}`); an upload creates nothing else, so there
 * is nothing else to undo. Asked first, because the only way back is to upload
 * the bill again and wait for another read.
 *
 * Gone already (404) counts as cancelled: another tab got there first.
 */
export default function CancelUploadButton({
  importId,
  label,
  onCancelled,
  variant = 'link',
}: {
  importId: string;
  /** What the dialog names, e.g. "bill.pdf + 1 more". */
  label: string;
  onCancelled: () => void;
  variant?: 'link' | 'button';
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/show-bill-imports/${importId}`, { method: 'DELETE' });
      if (res.ok || res.status === 404) {
        setAsking(false);
        onCancelled();
        return;
      }
      const body = await res.json().catch(() => null);
      setError(errorMessage(body, 'The upload could not be cancelled.'));
    } catch {
      setError('The upload could not be cancelled.');
    }
    setBusy(false);
    setAsking(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setAsking(true);
        }}
        disabled={busy}
        className={
          variant === 'button'
            ? 'text-sm rounded px-3 py-2 border disabled:opacity-50'
            : 'text-sm underline disabled:opacity-50'
        }
        style={
          variant === 'button'
            ? { borderColor: 'var(--error)', color: 'var(--error-strong)', backgroundColor: 'var(--surface)' }
            : { color: 'var(--error-strong)' }
        }
      >
        {busy ? 'Cancelling…' : 'Cancel upload'}
      </button>
      {error && (
        <span className="text-xs" role="alert" style={{ color: 'var(--error-strong)' }}>
          {error}
        </span>
      )}
      {asking && (
        <ConfirmDialog
          title="Cancel this upload?"
          message={`${label} will be deleted, and no show will be created from it. To start again, upload the show bill again.`}
          confirmLabel="Cancel upload"
          cancelLabel="Keep it"
          destructive
          confirming={busy}
          onConfirm={cancel}
          onCancel={() => setAsking(false)}
        />
      )}
    </>
  );
}
