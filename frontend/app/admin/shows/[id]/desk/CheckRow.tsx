'use client';

export type VerificationKind =
  | 'horse_age'
  | 'horse_registration'
  | 'exhibitor_membership'
  | 'horse_health_document';
export type VerificationStatus = 'verified' | 'stale' | 'unverified' | 'not_on_file';

export interface VerificationCheck {
  kind: VerificationKind;
  status: VerificationStatus;
  current_value: string | null;
  /** When the membership lapses, where one is recorded (migration 117). */
  expires_at: string | null;
  /**
   * Whether it has lapsed by the last day of the show — null when there is no
   * expiry on file, because "we don't know" and "it's current" are different
   * answers. Reported beside `status`, never folded into it: `status` is about
   * whether anybody inspected the card, this is about whether the card is good.
   */
  lapsed: boolean | null;
  association_id: string | null;
  association_code: string | null;
  association_name: string | null;
  verification_id: string | null;
  verified_value: string | null;
  verified_by_name: string | null;
  verified_at: string | null;
  note: string | null;
}

export const STATUS_PILL: Record<VerificationStatus, { label: string; bg: string; text: string }> = {
  verified: { label: '✓ Verified', bg: '#d1fae5', text: '#065f46' },
  stale: { label: '⚠ Changed since', bg: '#fef3c7', text: '#92400e' },
  unverified: { label: '○ Not checked', bg: '#f5ede0', text: '#8b4513' },
  not_on_file: { label: '— Nothing on file', bg: '#e5e7eb', text: '#374151' },
};

/** What staff are told to physically pick up and read. */
const WHAT_TO_INSPECT: Record<VerificationKind, string> = {
  horse_age: 'the foaling date printed on the registration papers',
  horse_registration: 'the registration number on the papers',
  exhibitor_membership: 'the membership card',
  // Health documents have their own row; this entry keeps the record total.
  horse_health_document: 'the document',
};

const MISSING_HINT: Record<VerificationKind, string> = {
  horse_age: 'No foaling date on the horse record — add it from the papers before verifying.',
  horse_registration: 'No registration number on file for this association.',
  exhibitor_membership: 'No membership number on file for this association.',
  horse_health_document: 'Nothing on file.',
};

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/** A date-only value (an expiry), read as a plain day rather than an instant. */
function formatDay(isoDate: string) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export default function CheckRow({
  label,
  check,
  busy,
  onVerify,
  onUndo,
}: {
  label: string;
  check: VerificationCheck;
  busy: boolean;
  onVerify: () => void;
  onUndo: () => void;
}) {
  const pill = STATUS_PILL[check.status];
  const canVerify = check.status !== 'not_on_file';

  return (
    <div
      className="flex items-start justify-between gap-3 py-2 border-t first:border-t-0"
      style={{ borderColor: '#f0e6d6' }}
    >
      <div className="min-w-0">
        <div className="text-sm" style={{ color: '#2c1810' }}>
          <span className="font-medium">{label}</span>
          {check.current_value && (
            <span className="ml-2 font-mono text-xs" style={{ color: '#5a3e2b' }}>
              {check.current_value}
            </span>
          )}
        </div>

        {/* A stale check is the one case where the two values differ, and seeing
            both is the whole point — staff need to know what changed under a
            sign-off they already gave. */}
        {check.status === 'stale' && (
          <p className="text-xs mt-0.5" style={{ color: '#92400e' }}>
            Signed off against <span className="font-mono">{check.verified_value}</span>
            {check.verified_by_name ? ` by ${check.verified_by_name}` : ''} — the record has
            changed since. Check the paper again.
          </p>
        )}

        {check.status === 'verified' && (
          <p className="text-xs mt-0.5" style={{ color: '#8b7355' }} suppressHydrationWarning>
            {check.verified_by_name ?? 'Staff'}
            {check.verified_at ? ` · ${formatWhen(check.verified_at)}` : ''}
            {check.note ? ` · ${check.note}` : ''}
          </p>
        )}

        {check.status === 'not_on_file' && (
          <p className="text-xs mt-0.5" style={{ color: '#8b7355' }}>
            {MISSING_HINT[check.kind]}
          </p>
        )}

        {/* Whether the card is still good is a separate question from whether
            anybody has looked at it, so it reads as its own line. Judged against
            the last day of the show, not today — a card that lapses on the
            Saturday is exactly what the desk is here to catch. */}
        {check.lapsed === true && (
          <p className="text-xs mt-0.5 font-medium" style={{ color: '#b91c1c' }} suppressHydrationWarning>
            Lapsed {formatDay(check.expires_at!)} — before the show ends.
          </p>
        )}
        {check.lapsed === false && check.expires_at && (
          <p className="text-xs mt-0.5" style={{ color: '#8b7355' }} suppressHydrationWarning>
            Current through {formatDay(check.expires_at)}.
          </p>
        )}
        {check.kind === 'exhibitor_membership' && check.current_value && !check.expires_at && (
          <p className="text-xs mt-0.5" style={{ color: '#8b7355' }}>
            No expiry on file — standing unknown.
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <span
          className="text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap"
          style={{ backgroundColor: pill.bg, color: pill.text }}
        >
          {pill.label}
        </span>

        {check.status === 'verified' ? (
          <button
            type="button"
            onClick={onUndo}
            disabled={busy}
            title="Remove this sign-off — use when it was recorded against the wrong row"
            className="text-xs hover:underline disabled:opacity-50"
            style={{ color: '#8b7355' }}
          >
            Undo
          </button>
        ) : (
          <button
            type="button"
            onClick={onVerify}
            disabled={busy || !canVerify}
            title={
              canVerify
                ? `Records that you have physically inspected ${WHAT_TO_INSPECT[check.kind]}`
                : MISSING_HINT[check.kind]
            }
            className="text-xs font-medium px-2.5 py-1 rounded text-white disabled:opacity-50"
            style={{ backgroundColor: '#8b4513' }}
          >
            {check.status === 'stale' ? 'Re-verify' : 'I inspected it'}
          </button>
        )}
      </div>
    </div>
  );
}
