'use client';

import { COLORS } from './types';
import type { WaiverCheck } from './types';
import { rowFrame, ToDo } from './NeedsAction';

/**
 * One waiver at the desk: a checkbox. They signed it, or they did not.
 *
 * A signature is not a verification. Every other sign-off on this screen reads
 * its value off a record so a caller cannot attest to something nobody has on
 * file — but there is nothing to read a signature from, and nothing for it to
 * go stale against. It is either there or it is not, so the desk asks exactly
 * that: tick once the signed paper is in the show office. The backend records
 * the exhibitor's own name on the row.
 *
 * This used to be a form for everything but a futurity's release — type the
 * name as signed on the blank, say whether a guardian signed for a minor — and
 * the show office asked for the tick instead. The paper in the folder is what
 * records who held the pen; the app's job is the outstanding count, so a show
 * running on clipboards still knows who it is waiting on.
 *
 * A waiver the exhibitor signed in the app shows ticked and locked, with Undo
 * beside it: that signature is theirs, and unticking a box is too easy a way
 * to remove it by accident.
 */

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function WaiverRow({
  waiver,
  busy,
  onMarkSigned,
  onUndo,
}: {
  waiver: WaiverCheck;
  busy: boolean;
  /** Record that the signed paper is in the office. No name is typed. */
  onMarkSigned: () => void;
  onUndo: () => void;
}) {
  const signed = waiver.status === 'signed';
  const signedInApp = signed && !waiver.on_paper;
  const frame = rowFrame(waiver.is_required && !signed);
  const when = waiver.signed_at ? ` · ${formatWhen(waiver.signed_at)}` : '';

  return (
    <div className={frame.className} style={frame.style}>
      <div className="flex items-start justify-between gap-3">
        <label
          className="flex items-start gap-2 text-sm min-w-0 cursor-pointer"
          style={{ color: COLORS.text }}
          title={
            signedInApp
              ? 'The exhibitor signed this in the app'
              : signed
                ? 'Untick if this was marked against the wrong person'
                : 'Tick once the signed paper is in the show office'
          }
        >
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5 shrink-0"
            checked={signed}
            disabled={busy || signedInApp}
            onChange={(e) => {
              if (e.target.checked) onMarkSigned();
              else onUndo();
            }}
          />
          <span className="min-w-0">
            <span className="font-medium">{waiver.title}</span>
            {!waiver.is_required && (
              <span className="ml-2 text-xs" style={{ color: COLORS.muted }}>optional</span>
            )}
            {signed && (
              <span className="block text-xs mt-0.5" style={{ color: COLORS.muted }} suppressHydrationWarning>
                {signedInApp
                  ? `Signed in the app by ${waiver.signed_by_guardian ? 'guardian ' : ''}${waiver.signed_name}${
                      waiver.signed_by_guardian && waiver.guardian_relationship
                        ? ` (${waiver.guardian_relationship})`
                        : ''
                    }${when}`
                  : `Signed on paper${waiver.recorded_by_name ? ` · recorded by ${waiver.recorded_by_name}` : ''}${when}`}
              </span>
            )}
            {!signed && waiver.is_required && (
              <ToDo>Not signed — tick once the signed paper is in the show office.</ToDo>
            )}
          </span>
        </label>
        {signedInApp && (
          <button
            type="button"
            onClick={onUndo}
            disabled={busy}
            title="Remove this signature — use when it was recorded against the wrong person"
            className="text-xs hover:underline disabled:opacity-50 shrink-0"
            style={{ color: COLORS.muted }}
          >
            Undo
          </button>
        )}
      </div>
    </div>
  );
}
