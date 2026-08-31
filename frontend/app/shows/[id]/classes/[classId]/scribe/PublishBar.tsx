'use client';

import { useRef, useState } from 'react';
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

/** The association placing-depth shortfall the backend reports (APHA SC-110.I). */
interface DepthShortfall {
  code: string;
  message: string;
  required_places: number;
  shortfall: { judge_id: string | null; judge_name: string; missing: number[] }[];
}

/** Equal scores nobody has separated (APHA AM-115.B.2 and the pattern class
 *  procedures). A different question from a shortfall: that one asks whether
 *  the card is finished, this one asks which of two horses won. */
interface TieBlock {
  code: string;
  message: string;
  ties: {
    judge_id: string | null;
    judge_name: string;
    place: number;
    entry_ids: string[];
  }[];
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
  const [tieBlock, setTieBlock] = useState<TieBlock | null>(null);
  // Acknowledgements accumulate across rounds. The backend checks ties first,
  // so saying yes to a tie and then meeting a depth shortfall must not quietly
  // drop the first answer and re-ask it.
  const acks = useRef({ incomplete: false, ties: false });
  // The association's own placing-depth rule, reported by the backend rather
  // than guessed at here — APHA wants one through seven under every judge
  // (SC-110.I), and other associations say nothing at all. The local gap check
  // only sees interior gaps, so a card that simply stops at third reaches this.
  const [depthShortfall, setDepthShortfall] = useState<DepthShortfall | null>(null);

  const isLive = publishedAt !== null;

  const doPublish = async (ack: { incomplete?: boolean; ties?: boolean } = {}) => {
    acks.current = { ...acks.current, ...ack };
    setPublishing(true);
    setPublishError(null);
    setConfirmGap(false);
    try {
      // Post what is on screen, not what happened to have landed already.
      await flush();
      const res = await fetch('/api/results/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          showId,
          classId,
          acknowledge_incomplete: acks.current.incomplete,
          acknowledge_ties: acks.current.ties,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = json.detail;
        if (detail && typeof detail === 'object' && detail.code === 'TIES_UNRESOLVED') {
          setTieBlock(detail as TieBlock);
          return;
        }
        if (detail && typeof detail === 'object' && detail.code === 'PLACINGS_INCOMPLETE') {
          setDepthShortfall(detail as DepthShortfall);
          return;
        }
        throw new Error(typeof detail === 'string' ? detail : 'Failed to post results');
      }
      setDepthShortfall(null);
      setTieBlock(null);
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
          !confirmGap && !depthShortfall && !tieBlock && (
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

      {tieBlock && (
        <div
          className="mt-3 px-3 py-2 rounded text-sm space-y-2"
          style={{ backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }}
        >
          <p>⚠ {tieBlock.message}</p>
          <ul className="list-disc pl-5">
            {tieBlock.ties.map((t) => (
              <li key={`${t.judge_id ?? 'unattributed'}-${t.place}`}>
                <span className="font-medium">{t.judge_name}</span> — {t.entry_ids.length}{' '}
                entries tied for place {t.place}
              </li>
            ))}
          </ul>
          <p style={{ color: '#a16207' }}>
            Set the order the judge called on the tied rows. The scores stay exactly
            as they were entered.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => setTieBlock(null)}
              className="font-semibold hover:underline"
            >
              Go back and break the tie
            </button>
            <button
              type="button"
              onClick={() => void doPublish({ ties: true })}
              disabled={publishing}
              className="hover:underline disabled:opacity-50"
              title="Post the class with a shared place"
            >
              {publishing ? 'Posting…' : 'The judge left it tied — post anyway'}
            </button>
          </div>
        </div>
      )}

      {depthShortfall && (
        <div
          className="mt-3 px-3 py-2 rounded text-sm space-y-2"
          style={{ backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }}
        >
          <p>
            ⚠ {depthShortfall.message}
          </p>
          <ul className="list-disc pl-5">
            {depthShortfall.shortfall.map((s) => (
              <li key={s.judge_id ?? 'unattributed'}>
                <span className="font-medium">{s.judge_name}</span> — missing {s.missing.join(', ')}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => void doPublish({ incomplete: true })}
              disabled={publishing}
              className="font-semibold hover:underline disabled:opacity-50"
            >
              {publishing ? 'Posting…' : 'Post anyway'}
            </button>
            <button
              type="button"
              onClick={() => setDepthShortfall(null)}
              className="hover:underline"
            >
              Go back
            </button>
          </div>
        </div>
      )}

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
            onClick={() => void doPublish({ incomplete: true })}
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
