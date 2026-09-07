'use client';

import { useState } from 'react';
import { COLORS } from './types';
import type { HorseHealthCheck } from './types';

/**
 * One health document at the desk: what the file says, and what the office saw.
 *
 * Two facts on one line, and they can disagree in both directions. The
 * documents on file say whether the date is still good; only a person at the
 * counter says whether the paper is genuine, present, and describes *this*
 * horse. A current Coggins nobody has looked at and a lapsed one the office is
 * holding are different situations, and staff have to be able to tell them
 * apart at a glance.
 *
 * Which is why the sign-off is never blocked by "nothing on file". An exhibitor
 * handing over a paper Coggins the app has never seen is the ordinary case at a
 * horse show, and a checkbox that refused it would be useless exactly there.
 *
 * When the file does not already cover the horse, inspecting asks for the
 * expiry printed on that paper. Given, and covering the show, it clears the
 * flag — a secretary who has just held a valid negative test in their hands
 * should not still be told to go and find one. Left blank, the inspection is
 * still recorded and the horse stays flagged, which is right for a document
 * that was illegible or genuinely lapsed: "I looked at this" and "this is
 * valid" are different claims.
 */

const HEALTH_PILL: Record<
  HorseHealthCheck['status'],
  { label: string; bg: string; text: string }
> = {
  valid: { label: '✓ Current', bg: 'var(--success-border)', text: 'var(--success-strong)' },
  missing: { label: '✕ Nothing on file', bg: 'var(--error-bg)', text: 'var(--error-strong)' },
  undated: { label: '⚠ No date', bg: 'var(--warning-bg)', text: 'var(--warning)' },
  expired: { label: '✕ Out of date', bg: 'var(--error-bg)', text: 'var(--error-strong)' },
};

const INSPECTION_PILL = {
  verified: { label: '✓ Inspected', bg: 'var(--success-border)', text: 'var(--success-strong)' },
  stale: { label: '⚠ Changed since', bg: 'var(--warning-bg)', text: 'var(--warning)' },
  unverified: { label: '○ Not inspected', bg: 'var(--bg-subtle)', text: 'var(--accent)' },
} as const;

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function HealthCheckRow({
  check,
  busy,
  viewing,
  onView,
  onInspect,
  onUndo,
}: {
  check: HorseHealthCheck;
  busy: boolean;
  viewing: boolean;
  onView: () => void;
  /** `attestedExpiry` is the date read off the paper, or null when staff could
   *  not read one. Only ever sent for a document the file does not cover. */
  onInspect: (attestedExpiry: string | null) => void;
  onUndo: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [expiry, setExpiry] = useState('');

  const health = HEALTH_PILL[check.status];
  const inspection = check.inspection ?? {
    status: 'unverified' as const,
    verification_id: null,
    verified_by_name: null,
    verified_at: null,
    attested_expiry: null,
    note: null,
  };
  const pill = INSPECTION_PILL[inspection.status];

  // The file already covers the horse, so there is no date to ask for — unless
  // the only reason it reads current is a previous attestation, in which case
  // the paper is still the source and re-inspecting should ask again.
  const needsDate = check.status !== 'valid' || check.attested;

  const startInspect = () => {
    if (!needsDate) {
      onInspect(null);
      return;
    }
    setExpiry(inspection.attested_expiry ?? '');
    setRecording(true);
  };

  const submit = () => {
    onInspect(expiry || null);
    setRecording(false);
  };

  return (
    <div className="py-2 border-t first:border-t-0" style={{ borderColor: 'var(--bg-subtle)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium" style={{ color: COLORS.text }}>
            {check.label}
          </div>
          <p
            className="text-xs mt-0.5"
            style={{ color: check.status === 'valid' ? COLORS.muted : 'var(--error-strong)' }}
          >
            {check.message}
            {check.expiry_date && check.status !== 'missing' ? ` (${check.expiry_date})` : ''}
          </p>
          {check.attested && (
            // Say plainly that the app is not holding this document. The next
            // show has not seen that paper and will flag the horse again.
            <p className="text-xs mt-0.5" style={{ color: 'var(--warning)' }}>
              Not uploaded — this show is covered by the office having seen it.
            </p>
          )}
          {check.notes && (
            <p className="text-xs mt-0.5 italic" style={{ color: COLORS.muted }}>
              This show asks for: {check.notes}
            </p>
          )}

          {inspection.status === 'stale' && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--warning)' }}>
              The documents on file have changed since this was signed off
              {inspection.verified_by_name ? ` by ${inspection.verified_by_name}` : ''}. Look again.
            </p>
          )}
          {inspection.status === 'verified' && (
            <p className="text-xs mt-0.5" style={{ color: COLORS.muted }} suppressHydrationWarning>
              Inspected by {inspection.verified_by_name ?? 'staff'}
              {inspection.verified_at ? ` · ${formatWhen(inspection.verified_at)}` : ''}
              {inspection.attested_expiry ? ` · read as expiring ${inspection.attested_expiry}` : ''}
              {inspection.note ? ` · ${inspection.note}` : ''}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
          <span
            className="text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap"
            style={{ backgroundColor: health.bg, color: health.text }}
            title={
              check.attested
                ? 'Covered because this office inspected the paper — nothing is uploaded'
                : 'What the documents uploaded to the app say'
            }
          >
            {health.label}
            {check.attested ? ' (on paper)' : ''}
          </span>
          <span
            className="text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap"
            style={{ backgroundColor: pill.bg, color: pill.text }}
            title="Whether this show's office has physically looked at the paper"
          >
            {pill.label}
          </span>

          <button
            type="button"
            onClick={onView}
            aria-pressed={viewing}
            title={
              check.status === 'missing'
                ? 'Nothing is uploaded for this document — the viewer will say so'
                : 'Show the uploaded scan beside this check'
            }
            className="text-xs px-2 py-1 rounded border"
            style={{
              borderColor: COLORS.border,
              backgroundColor: viewing ? COLORS.dark : COLORS.surface,
              color: viewing ? COLORS.onDark : COLORS.accent,
            }}
          >
            {viewing ? 'Hide' : 'View'}
          </button>

          {inspection.status === 'verified' && !recording ? (
            <button
              type="button"
              onClick={onUndo}
              disabled={busy}
              title="Remove this sign-off — use when it was recorded against the wrong horse"
              className="text-xs hover:underline disabled:opacity-50"
              style={{ color: COLORS.muted }}
            >
              Undo
            </button>
          ) : (
            !recording && (
              <button
                type="button"
                onClick={startInspect}
                disabled={busy}
                title={`Records that you have physically inspected this horse's ${check.label.toLowerCase()} — on paper or on screen`}
                className="text-xs font-medium px-2.5 py-1 rounded text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                {inspection.status === 'stale' ? 'Re-inspect' : 'I inspected it'}
              </button>
            )
          )}
        </div>
      </div>

      {recording && (
        <div
          className="mt-2 rounded border p-2"
          style={{ borderColor: COLORS.borderSoft, backgroundColor: 'var(--surface)' }}
        >
          <label className="block text-xs" style={{ color: COLORS.text }}>
            Expiry date printed on the document
            <input
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              className="mt-1 block border rounded px-2 py-1 text-sm"
              style={{ borderColor: COLORS.border }}
            />
          </label>
          <p className="text-xs mt-1" style={{ color: COLORS.muted }}>
            Fill this in and the horse stops showing as outstanding for this show. Leave it blank
            if the paper is illegible or genuinely out of date — the inspection is still recorded
            and the horse stays flagged.
          </p>
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="text-xs font-medium px-2.5 py-1 rounded text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              {busy ? 'Saving…' : expiry ? 'Record inspection' : 'Record without a date'}
            </button>
            <button
              type="button"
              onClick={() => setRecording(false)}
              className="text-xs hover:underline"
              style={{ color: COLORS.muted }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
