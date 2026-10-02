'use client';

import { COLORS } from './types';
import type { HorseHealthCheck } from './types';
import { rowFrame, ToDo } from './NeedsAction';

/**
 * One health document at the desk: what the file says, and what the office saw.
 *
 * Two facts on one line. The documents on file say whether the date is still
 * good; only a person at the counter says whether the paper is genuine,
 * present, and describes *this* horse. A current Coggins nobody has looked at
 * and a paper Coggins the app has never seen are different situations, and
 * staff have to be able to tell them apart at a glance.
 *
 * Which is why the sign-off is never blocked by "nothing on file". An exhibitor
 * handing over a paper Coggins the app has never seen is the ordinary case at a
 * horse show, and a button that refused it would be useless exactly there.
 *
 * **Pressing "I inspected it" puts the horse in good standing for this show.**
 * It is the office saying the paper describes this horse and covers the show,
 * and it clears the flag in one press (`attested_health` on the backend). It
 * used to open a form asking for the expiry printed on the paper, and an
 * inspection recorded without one left the horse flagged — so an office that
 * had just held a good Coggins went on being told to find one. A paper that is
 * lapsed or does not match the horse is simply not signed off: the row stays
 * red and the exhibitor is the one to chase. It clears this show only; the next
 * show has not seen that paper and asks again.
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
  physicalCheck,
  onView,
  onInspect,
  onUndo,
}: {
  check: HorseHealthCheck;
  busy: boolean;
  viewing: boolean;
  /** Whether this show asks for the paper at the counter. Where it does, an
   *  uninspected document is paperwork the desk owes even when the file is
   *  current; where it does not, only a document the file does not cover is. */
  physicalCheck: boolean;
  onView: () => void;
  onInspect: () => void;
  onUndo: () => void;
}) {
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
  const label = check.label.toLowerCase();

  // A document the file does not cover is flagged at the top of the panel
  // whatever the show asks for; an uninspected one is owed only where the show
  // wants the paper produced. The same two facts the panel's count adds up.
  const flagged = check.status !== 'valid';
  const owed = physicalCheck && inspection.status !== 'verified';
  const frame = rowFrame(flagged || owed);

  return (
    <div className={frame.className} style={frame.style}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium" style={{ color: COLORS.text }}>
            {check.label}
          </div>
          <p
            className="text-xs mt-0.5"
            style={{ color: flagged ? 'var(--error-strong)' : COLORS.muted }}
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
              {inspection.verified_by_name ? ` by ${inspection.verified_by_name}` : ''}.
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

          {/* What to do, in words, on every red row. The flagged case leads,
              because pressing the button there is a claim about the paper and
              the row has to say which claim. */}
          {flagged ? (
            <ToDo>
              Look at the paper. If it describes this horse and covers the show, press I
              inspected it — that clears it for this show. If not, they need a current one.
            </ToDo>
          ) : owed && inspection.status === 'stale' ? (
            <ToDo>Look at the paper again, then press Re-inspect.</ToDo>
          ) : owed ? (
            <ToDo>Check the paper against the horse, then press I inspected it.</ToDo>
          ) : null}
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

          {inspection.status === 'verified' ? (
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
            <button
              type="button"
              onClick={onInspect}
              disabled={busy}
              title={`Records that you have seen this horse's ${label}, that it describes this horse and that it covers the show. Clears it for this show only.`}
              className="text-xs font-medium px-2.5 py-1 rounded text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              {busy ? 'Saving…' : inspection.status === 'stale' ? 'Re-inspect' : 'I inspected it'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
