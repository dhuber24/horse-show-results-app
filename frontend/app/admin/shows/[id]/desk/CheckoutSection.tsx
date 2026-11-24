'use client';

import Link from 'next/link';
import LocalTime from '@/components/LocalTime';
import StallInspectionCheck from './StallInspectionCheck';
import { formatMoney } from '@/lib/financials';
import { COLORS } from './types';
import type { Desk, DeskExhibitor } from './types';

type Run = (key: string, fn: () => Promise<Response>, fallback: string) => Promise<boolean>;

/**
 * Checking an exhibitor out at the desk (migration 200).
 *
 * The stall inspection, where the show requires one; **Mark checked out**,
 * which records when and by whom; and what they still owe beside it, with the
 * way to their account. Not their bill: the desk registers people, and the
 * itemised bill — every line, office charges and credits, payments — is on
 * Financials, one link away.
 *
 * A record, never a gate: an exhibitor still owing can be checked out, and is
 * told apart only by the balance shown beside the button.
 */
export default function CheckoutSection({
  showId,
  desk,
  exhibitor,
  busy,
  run,
}: {
  showId: string;
  desk: Desk;
  exhibitor: DeskExhibitor;
  busy: Set<string>;
  run: Run;
}) {
  const balance = exhibitor.balance_cents;
  const checkoutUrl = `/api/shows/${showId}/desk/exhibitors/${exhibitor.exhibitor_id}/checkout`;

  return (
    <div className="space-y-3 text-sm">
      <StallInspectionCheck showId={showId} desk={desk} exhibitor={exhibitor} busy={busy} run={run} />
      {exhibitor.checked_out_at ? (
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1" style={{ color: COLORS.text }}>
          <span>
            <span style={{ color: 'var(--success)' }}>✓ Checked out</span>{' '}
            <LocalTime iso={exhibitor.checked_out_at} />
            {exhibitor.checked_out_by_name && <> by {exhibitor.checked_out_by_name}</>}
          </span>
          <button
            type="button"
            onClick={() =>
              void run('checkout', () => fetch(checkoutUrl, { method: 'DELETE' }), 'Could not undo the checkout.')
            }
            disabled={busy.has('checkout')}
            className="text-xs underline disabled:opacity-50"
            style={{ color: COLORS.muted }}
          >
            Undo
          </button>
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() =>
              void run('checkout', () => fetch(checkoutUrl, { method: 'POST' }), 'Could not check them out.')
            }
            disabled={busy.has('checkout')}
            className="rounded border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            style={{ borderColor: COLORS.accent, color: COLORS.accent }}
          >
            {busy.has('checkout') ? 'Checking out…' : 'Mark checked out'}
          </button>
          {balance > 0 && (
            <span className="text-xs" style={{ color: 'var(--error)' }}>
              Still owing {formatMoney(balance)} — record what they pay before they go.
            </span>
          )}
        </div>
      )}
      <Link
        href={`/admin/shows/${showId}/financials/exhibitors?exhibitor=${exhibitor.exhibitor_id}`}
        className="inline-block hover:underline"
        style={{ color: COLORS.accent }}
        title={`${exhibitor.exhibitor_name}’s itemised bill and payments, on Financials`}
      >
        Their bill and payments on Financials →
      </Link>
    </div>
  );
}
