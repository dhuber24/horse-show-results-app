import { formatMoney } from '@/lib/financials';

/**
 * What one exhibitor record is carrying, as `backend/exhibitor_merge.py`
 * reports it.
 *
 * Deliberately the things a person would *miss* if the wrong record were the
 * one removed — their classes, their number, their horses, their money — and
 * not a row count per table. A merge is chosen on these figures, so they are
 * the sentence the screens read out before the press.
 */
export interface MergeSummary {
  shows: number;
  class_entries: number;
  horses: number;
  memberships: number;
  signatures: number;
  payments_cents: number;
}

export interface MergeCandidate {
  exhibitor_id: string;
  full_name: string;
  email: string | null;
  has_account: boolean;
  office_record: boolean;
  /** `email` — the office wrote down the address an account was opened with.
   *  `name` — the names match and nothing else does. */
  matched_on: 'email' | 'name' | string;
  created_at: string;
  summary: MergeSummary | null;
}

/**
 * One line naming what a record holds.
 *
 * Here rather than in each screen because three of them print it — the desk's
 * merge control, the admin duplicate list, and the registry's pick-two — and
 * three copies is how "2 horses" and "2 horse" end up on the same page.
 */
export function holdingText(summary: MergeSummary): string {
  const parts: string[] = [];
  if (summary.shows) parts.push(`${summary.shows} show${summary.shows === 1 ? '' : 's'}`);
  if (summary.class_entries) {
    parts.push(`${summary.class_entries} class${summary.class_entries === 1 ? '' : 'es'}`);
  }
  if (summary.horses) parts.push(`${summary.horses} horse${summary.horses === 1 ? '' : 's'}`);
  if (summary.memberships) {
    parts.push(`${summary.memberships} membership${summary.memberships === 1 ? '' : 's'}`);
  }
  if (summary.signatures) {
    parts.push(`${summary.signatures} signature${summary.signatures === 1 ? '' : 's'}`);
  }
  if (summary.payments_cents) parts.push(`${formatMoney(summary.payments_cents)} paid`);
  return parts.length ? parts.join(' · ') : 'Nothing entered yet';
}
