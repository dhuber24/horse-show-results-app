'use client';

import { useState } from 'react';
import { COLORS } from './types';
import type { DeskExhibitor, DeskFuturity } from './types';
import { formatMoney } from '@/lib/financials';

/**
 * Enrolling a horse in a futurity, from the desk.
 *
 * A futurity class carries no entry fee of its own: the price is the category
 * the horse is enrolled under, times the futurity classes it is in, plus the
 * office fee (migration 107). So a class entry in a futurity class with no
 * enrollment behind it is billed nothing — the desk's total simply reads short,
 * and nothing said why. The enrollment used to be a separate trip to the
 * futurity's Entries screen; these are the same questions asked where the
 * class was entered.
 *
 * **No category is picked by default.** The categories are priced $75, $100
 * and $150 on the same class depending on how the horse qualified, and a
 * default would quietly charge whichever happened to be listed first.
 */

export type EnrollmentChoice = {
  tierId: string;
  isMember: boolean;
  membershipId: string;
};

export const EMPTY_CHOICE: EnrollmentChoice = { tierId: '', isMember: false, membershipId: '' };

/** Whether the choice is complete enough for the endpoint to accept. */
export function choiceIsComplete(futurity: DeskFuturity, choice: EnrollmentChoice): boolean {
  return futurity.fee_tiers.length === 0 || choice.tierId !== '';
}

function detailMessage(body: unknown, fallback: string): string {
  const b = body as { detail?: unknown; error?: string } | null;
  if (typeof b?.detail === 'string') return b.detail;
  const d = b?.detail as { message?: string } | undefined;
  return d?.message ?? b?.error ?? fallback;
}

/**
 * Posts the enrollment. A futurity entry hangs off the exhibitor's roster row,
 * so one is created first for somebody the office entered by hand before they
 * had one — the same idempotent call the desk's "add someone" makes.
 *
 * Returns an error message, or null on success.
 */
export async function enrollHorse({
  showId,
  futurity,
  exhibitor,
  horseId,
  choice,
}: {
  showId: string;
  futurity: DeskFuturity;
  exhibitor: DeskExhibitor;
  horseId: string;
  choice: EnrollmentChoice;
}): Promise<string | null> {
  let showEntryId = exhibitor.show_entry_id;
  if (!showEntryId) {
    const rosterRes = await fetch(`/api/shows/${showId}/desk/exhibitors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exhibitor_id: exhibitor.exhibitor_id }),
    });
    const roster = await rosterRes.json().catch(() => null);
    if (!rosterRes.ok || !roster?.show_entry_id) {
      return detailMessage(roster, 'Could not put them on the show roster.');
    }
    showEntryId = roster.show_entry_id as string;
  }

  const res = await fetch(`/api/shows/${showId}/futurities/${futurity.id}/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      show_entry_id: showEntryId,
      horse_id: horseId,
      fee_tier_id: choice.tierId || null,
      membership_option_id: choice.membershipId || null,
      is_member: choice.isMember,
    }),
  });
  if (!res.ok) {
    return detailMessage(await res.json().catch(() => null), 'Could not enroll that horse.');
  }
  return null;
}

/** The category, the member flag, and a membership bought with the entry. */
export function EnrollmentFields({
  futurity,
  value,
  onChange,
  idPrefix,
}: {
  futurity: DeskFuturity;
  value: EnrollmentChoice;
  onChange: (next: EnrollmentChoice) => void;
  idPrefix: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {futurity.fee_tiers.length > 0 && (
        <select
          id={`${idPrefix}-tier`}
          value={value.tierId}
          onChange={(e) => onChange({ ...value, tierId: e.target.value })}
          aria-label={`${futurity.name} category`}
          className="flex-1 min-w-[200px] border rounded px-3 py-2 text-sm"
          style={{ borderColor: COLORS.border }}
        >
          <option value="">Pick a category…</option>
          {futurity.fee_tiers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} — {formatMoney(t.amount_cents)}/class
            </option>
          ))}
        </select>
      )}
      {futurity.membership_options.length > 0 && (
        <select
          id={`${idPrefix}-membership`}
          value={value.membershipId}
          onChange={(e) => onChange({ ...value, membershipId: e.target.value })}
          aria-label="Membership bought with the entry"
          className="flex-1 min-w-[180px] border rounded px-3 py-2 text-sm"
          style={{ borderColor: COLORS.border }}
        >
          <option value="">No membership bought</option>
          {futurity.membership_options.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} — {formatMoney(m.amount_cents)}
            </option>
          ))}
        </select>
      )}
      <label
        className="flex items-center gap-1.5 text-xs"
        style={{ color: COLORS.text }}
        title="Decides the office fee. Buying a membership above does not change it — somebody joining today pays the non-member office fee, as the paper form charges."
      >
        <input
          type="checkbox"
          checked={value.isMember}
          onChange={(e) => onChange({ ...value, isMember: e.target.checked })}
        />
        Already a club member ({formatMoney(futurity.office_fee_member_cents)} office fee, not{' '}
        {formatMoney(futurity.office_fee_nonmember_cents)})
      </label>
    </div>
  );
}

/**
 * A horse in a futurity's classes that is not enrolled in the futurity, with
 * the enrollment one press away.
 */
export function UnenrolledFuturityRow({
  showId,
  exhibitor,
  futurity,
  horseId,
  horseName,
  classCount,
  onEnrolled,
}: {
  showId: string;
  exhibitor: DeskExhibitor;
  futurity: DeskFuturity;
  horseId: string;
  horseName: string;
  classCount: number;
  onEnrolled: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<EnrollmentChoice>(EMPTY_CHOICE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const complete = choiceIsComplete(futurity, choice);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const problem = await enrollHorse({ showId, futurity, exhibitor, horseId, choice });
    setBusy(false);
    if (problem) {
      setError(problem);
      return;
    }
    setOpen(false);
    await onEnrolled();
  };

  return (
    <div
      className="rounded border px-3 py-2 text-sm space-y-2"
      style={{ borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)' }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p style={{ color: 'var(--text-deep)' }}>
          <strong>{horseName}</strong> is in {classCount} {futurity.name} class
          {classCount === 1 ? '' : 'es'} but is not enrolled in the futurity, so nothing is billed
          for {classCount === 1 ? 'it' : 'them'}.
        </p>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-xs font-medium px-2.5 py-1 rounded shrink-0"
            style={{ backgroundColor: COLORS.accent, color: 'var(--surface)' }}
          >
            Enroll in the futurity
          </button>
        )}
      </div>
      {open && (
        <>
          <EnrollmentFields
            futurity={futurity}
            value={choice}
            onChange={setChoice}
            idPrefix={`enroll-${futurity.id}-${horseId}`}
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={busy || !complete}
              title={complete ? undefined : 'Pick the category this horse is entered under'}
              className="text-xs font-medium px-3 py-1.5 rounded disabled:opacity-50"
              style={{ backgroundColor: COLORS.dark, color: COLORS.onDark }}
            >
              {busy ? 'Enrolling…' : 'Enroll'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className="text-xs hover:underline"
              style={{ color: COLORS.muted }}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
