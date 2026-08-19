'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { SaveStatus } from './useAutosave';

/**
 * Save status plus the publish gate, shared by both scribe forms.
 *
 * The gate is the reason autosave is safe here: results write continuously
 * into a draft only show staff can read, and reach the public /live and
 * /results screens only when someone presses the button. A placement card is
 * full of gaps until the last horse is entered — without this, autosave would
 * broadcast wrong placings at the rail.
 */

interface Props {
  showId: string;
  classId: string;
  status: SaveStatus;
  lastSavedAt: Date | null;
  error: string | null;
  onRetry: () => void;
  publishedAt: string | null;
  onPublished: (at: string) => void;
  /**
   * Cards with missing place numbers, e.g. [{ label: 'Ann Reed', missing: [2, 5] }].
   * Confirmed at publish, not at save — posting the class posts every judge's
   * card, including ones the scribe is not currently looking at.
   */
  gapWarning?: { label: string; missing: number[] }[] | null;
  /** Nothing entered yet — there is nothing to post. */
  empty: boolean;
  /** Commits any pending keystroke before posting. */
  flush: () => Promise<void>;
}

const INK = '#2c1810';
const MUTED = '#8b7355';
const BORDER = '#d4b896';

function StatusLine({ status, lastSavedAt, error, onRetry }: Pick<Props, 'status' | 'lastSavedAt' | 'error' | 'onRetry'>) {
  if (status === 'saving') {
    return <span style={{ color: MUTED }}>Saving…</span>;
  }
  if (status === 'error') {
    return (
      <span className="flex items-center gap-2 flex-wrap" style={{ color: '#991b1b' }}>
        <span>⚠ {error ?? 'Save failed'} — your entries are still here.</span>
        <button type="button" onClick={onRetry} className="font-semibold hover:underline">
          Retry
        </button>
      </span>
    );
  }
  if (status === 'saved' && lastSavedAt) {
    return (
      <span style={{ color: '#065f46' }}>
        ✓ All changes saved ·{' '}
        {lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
    );
  }
  return <span style={{ color: MUTED }}>Changes save automatically.</span>;
}

export default function PublishBar({
  showId,
  classId,
  status,
  lastSavedAt,
  error,
  onRetry,
  publishedAt,
  onPublished,
  gapWarning,
  empty,
  flush,
}: Props) {
  const [publishing, setPublishing] = useState(false);
  const [confirmGap, setConfirmGap] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const isLive = publishedAt !== null;

  const doPublish = async () => {
    setPublishing(true);
    setPublishError(null);
    setConfirmGap(false);
    try {
      // Post what is on screen, not what happened to have landed already.
      await flush();
      const res = await fetch('/api/results/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showId, classId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.detail ?? 'Failed to post results');
      onPublished(json.results_published_at);
    } catch (err: any) {
      setPublishError(err.message ?? 'Failed to post results');
    } finally {
      setPublishing(false);
    }
  };

  const handlePublishClick = () => {
    if (gapWarning && gapWarning.length > 0 && !confirmGap) {
      setConfirmGap(true);
      return;
    }
    void doPublish();
  };

  return (
    <div
      className="mb-4 rounded-lg border p-3"
      style={{
        borderColor: isLive ? '#a7f3d0' : BORDER,
        backgroundColor: isLive ? '#ecfdf5' : '#faf7f2',
      }}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="text-sm">
          <p className="font-semibold mb-1" style={{ color: INK }}>
            {isLive ? '● Live — edits post immediately' : '○ Not posted'}
          </p>
          <p style={{ color: MUTED }}>
            {isLive
              ? 'These placings are on the public results screens. Corrections go live as you make them and are recorded in the audit history.'
              : 'Only show staff can see these. Nothing appears on the public results screens until you post.'}
          </p>
        </div>

        {isLive ? (
          <Link
            href={`/shows/${showId}/classes/${classId}`}
            className="text-sm font-medium hover:underline shrink-0 min-h-[44px] flex items-center"
            style={{ color: '#8b4513' }}
          >
            View public results →
          </Link>
        ) : (
          !confirmGap && (
            <button
              type="button"
              onClick={handlePublishClick}
              disabled={publishing || empty}
              title={empty ? 'Enter at least one placing first' : undefined}
              className="min-h-[44px] px-5 rounded-lg font-semibold text-sm shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: INK, color: '#f5ede0' }}
            >
              {publishing ? 'Posting…' : 'Post Results to Live'}
            </button>
          )
        )}
      </div>

      {confirmGap && gapWarning && (
        <div
          className="mt-3 px-3 py-2 rounded text-sm flex items-center gap-3 flex-wrap"
          style={{ backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }}
        >
          <span>
            ⚠ Place gap —{' '}
            {gapWarning
              .map((g) => `${g.label} missing ${g.missing.join(', ')}`)
              .join('; ')}
            . Post anyway?
          </span>
          <button
            type="button"
            onClick={() => void doPublish()}
            className="font-semibold hover:underline"
            style={{ color: '#b45309' }}
          >
            Yes, post
          </button>
          <button type="button" onClick={() => setConfirmGap(false)} className="hover:underline">
            Cancel
          </button>
        </div>
      )}

      {publishError && (
        <p className="mt-2 text-sm" style={{ color: '#991b1b' }}>
          ⚠ {publishError}
        </p>
      )}

      <div className="mt-2 pt-2 text-sm border-t" style={{ borderColor: '#e8ddd0' }}>
        <StatusLine status={status} lastSavedAt={lastSavedAt} error={error} onRetry={onRetry} />
      </div>
    </div>
  );
}
