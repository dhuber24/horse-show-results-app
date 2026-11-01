'use client';

import { useMemo, useState } from 'react';
import { errorMessage } from '@/lib/api-error';
import { cardPhotoHref, shrinkPhoto, type CardPhoto } from '@/lib/card-photos';
import type { JudgeCard } from './judges';

/**
 * Photos of the judge's card (migration 177), shared by both scribe forms.
 *
 * The scribe types the total; the card itself — every maneuver, penalty and
 * note in the judge's hand — is photographed here and read on the class page.
 * A photo is tagged with the card the scribe has open, so on a panel the J2 tab
 * photographs J2's card. Every photo of the class is listed whichever tab is
 * open, so one filed against a judge since taken off the panel is still here
 * to remove.
 *
 * Nobody outside the show staff sees a photo until the class is posted — the
 * card is the placings — and this says so, so a scribe is not left wondering
 * why the class page shows nothing yet.
 */

interface Props {
  showId: string;
  classId: string;
  cards: JudgeCard[];
  activeCard: JudgeCard;
  initialPhotos: CardPhoto[];
  posted: boolean;
}

const MUTED = 'var(--muted)';
const BORDER = 'var(--border)';

export default function CardPhotos({ showId, classId, cards, activeCard, initialPhotos, posted }: Props) {
  const [photos, setPhotos] = useState<CardPhoto[]>(initialPhotos);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The photo that did not go, and whose card it is, kept so Try again does
  // not mean taking it again — nor filing it under a tab opened since.
  const [unsent, setUnsent] = useState<{ file: File; judgeId: string | null } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const panel = cards.length > 1;
  const whose = panel ? `${activeCard.label}'s card` : 'the card';

  // In the panel's running order, so J1's photos come before J2's.
  const ordered = useMemo(() => {
    const position = (p: CardPhoto) => {
      const at = cards.findIndex((c) => c.judgeId === p.judge_id);
      return at === -1 ? cards.length : at;
    };
    return [...photos].sort((a, b) => position(a) - position(b));
  }, [photos, cards]);

  const shortLabel = (p: CardPhoto) => cards.find((c) => c.judgeId === p.judge_id)?.shortLabel ?? '—';

  async function upload(file: File, judgeId: string | null) {
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', await shrinkPhoto(file), 'card.jpg');
      if (judgeId) form.append('judge_id', judgeId);
      const res = await fetch(`/api/shows/${showId}/classes/${classId}/card-photos`, {
        method: 'POST',
        body: form,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorMessage(body, 'The photo did not upload.'));
        setUnsent({ file, judgeId });
        return;
      }
      setPhotos((prev) => [...prev, body as CardPhoto]);
      setUnsent(null);
    } catch {
      setError('The photo did not upload — check the signal and try again.');
      setUnsent({ file, judgeId });
    } finally {
      setUploading(false);
    }
  }

  async function remove(photoId: string) {
    setConfirmRemove(null);
    setError(null);
    try {
      const res = await fetch(`/api/shows/${showId}/classes/${classId}/card-photos/${photoId}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 404) {
        setError(errorMessage(await res.json().catch(() => null), 'The photo was not removed.'));
        return;
      }
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    } catch {
      setError('The photo was not removed — check the signal and try again.');
    }
  }

  function picked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared so picking the same photo again still counts as a pick.
    event.target.value = '';
    if (file) void upload(file, activeCard.judgeId);
  }

  const busyTitle = uploading ? 'A photo is still uploading' : undefined;

  return (
    <section className="mb-4 p-3 rounded-lg" style={{ border: `1px solid ${BORDER}`, backgroundColor: 'var(--surface)' }}>
      <h2 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
        {panel ? "Photos of the judges' cards" : "Photo of the judge's card"}
      </h2>
      <p className="text-xs mt-0.5 mb-3" style={{ color: MUTED }}>
        {posted
          ? 'Posted — exhibitors can see these on the class page.'
          : 'Exhibitors see these on the class page once the class is posted.'}
      </p>

      {ordered.length > 0 && (
        <ul className="flex flex-wrap gap-3 mb-3">
          {ordered.map((p) => (
            <li key={p.id} className="flex flex-col items-center gap-1 w-24">
              <a href={cardPhotoHref(showId, classId, p.id)} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={cardPhotoHref(showId, classId, p.id)}
                  alt={panel ? `${shortLabel(p)} card` : "Judge's card"}
                  className="w-24 h-24 object-cover rounded"
                  style={{ border: `1px solid ${BORDER}` }}
                  loading="lazy"
                />
              </a>
              {panel && (
                <span className="text-xs font-medium" style={{ color: MUTED }}>
                  {shortLabel(p)}
                </span>
              )}
              {confirmRemove === p.id ? (
                <span className="flex items-center gap-2 text-xs">
                  <button type="button" onClick={() => void remove(p.id)} className="min-h-[44px] font-semibold hover:underline" style={{ color: 'var(--error-strong)' }}>
                    Remove
                  </button>
                  <button type="button" onClick={() => setConfirmRemove(null)} className="min-h-[44px] hover:underline" style={{ color: MUTED }}>
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmRemove(p.id)} className="min-h-[44px] text-xs hover:underline" style={{ color: MUTED }}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* `capture` opens the camera on a phone; a computer ignores it and
            opens the file picker, which is what the office wants there. */}
        <label
          className={`inline-flex items-center min-h-[44px] px-4 rounded font-medium text-sm ${uploading ? 'opacity-60' : 'cursor-pointer'}`}
          style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}
          title={busyTitle}
        >
          {uploading ? 'Uploading…' : `📷 Take a photo of ${whose}`}
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={picked} disabled={uploading} />
        </label>
        <label
          className={`inline-flex items-center min-h-[44px] text-sm hover:underline ${uploading ? 'opacity-60' : 'cursor-pointer'}`}
          style={{ color: 'var(--accent)' }}
          title={busyTitle}
        >
          Choose a photo
          <input type="file" accept="image/*" className="sr-only" onChange={picked} disabled={uploading} />
        </label>
      </div>

      {error && (
        <p className="mt-2 text-sm flex items-center gap-2 flex-wrap" style={{ color: 'var(--error-strong)' }}>
          <span>⚠ {error}</span>
          {unsent && !uploading && (
            <button type="button" onClick={() => void upload(unsent.file, unsent.judgeId)} className="font-semibold hover:underline">
              Try again
            </button>
          )}
        </p>
      )}
    </section>
  );
}
