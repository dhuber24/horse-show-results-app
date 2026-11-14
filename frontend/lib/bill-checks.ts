/**
 * What a show set up from its show bill still has to have checked (migration 187).
 *
 * The show is created as a DRAFT straight from the read, and each doubt about
 * what was read — the reader's own, or the app's — is a check on a setup step,
 * against the record and field it is about. The step lists its checks at the
 * top, and the field itself is highlighted where the step draws it.
 *
 * A check is `open` until somebody accepts it, or until its field is changed or
 * its row deleted (`changed`, `removed` — decided by the backend on read). The
 * show cannot leave DRAFT while one is open. See `backend/showbill_checks.py`.
 */

import type { WizardStepKey } from '@/app/admin/shows/_wizard/WizardStepper';

export type BillCheckTarget = 'show' | 'class' | 'fee' | 'judge' | 'sanctioning';

export type BillCheckAction =
  | {
      kind: 'add_judge';
      first_name: string;
      last_name: string;
      association_ids: string[];
      candidate_ids: string[];
    }
  | {
      kind: 'add_venue';
      name: string | null;
      address: string | null;
      city: string | null;
      state: string | null;
    }
  /** `href` is relative to the show: `fees/entry` is `/admin/shows/{id}/fees/entry`. */
  | { kind: 'link'; label: string; href: string };

export type BillCheckState = 'open' | 'accepted' | 'changed' | 'removed';

export type BillCheck = {
  id: string;
  step: WizardStepKey;
  target_type: BillCheckTarget | null;
  target_id: string | null;
  field: string | null;
  message: string;
  /** `bill`: the reader was unsure of what it read. `app`: the app's own check
   *  of what it made of the read (a name-only match, a fee that bills everybody). */
  source: 'bill' | 'app';
  action: BillCheckAction | null;
  state: BillCheckState;
  accepted_at: string | null;
};

export function isOpen(check: BillCheck): boolean {
  return check.state === 'open';
}

/** Open checks per step — what the tab bar, the sidebar and the hub count. */
export function openCountByStep(checks: BillCheck[]): Partial<Record<WizardStepKey, number>> {
  const counts: Partial<Record<WizardStepKey, number>> = {};
  for (const c of checks) {
    if (isOpen(c)) counts[c.step] = (counts[c.step] ?? 0) + 1;
  }
  return counts;
}

/**
 * The checks about one record, or one field of it.
 *
 * `field` undefined is every check on the record, whatever field (or none) it
 * names — what a row highlight wants. A string is that field only. Show-level
 * checks have the show's id as `target_id`, so `id` may be left out for them.
 */
export function checksAbout(
  checks: BillCheck[],
  target: BillCheckTarget,
  id: string | null | undefined,
  field?: string | readonly string[],
): BillCheck[] {
  const fields = field === undefined ? null : new Set(typeof field === 'string' ? [field] : field);
  return checks.filter(
    (c) =>
      c.target_type === target &&
      (target === 'show' || id == null || c.target_id === id) &&
      (fields === null || (c.field !== null && fields.has(c.field))),
  );
}

/** Where a link action goes. */
export function actionHref(showId: string, action: Extract<BillCheckAction, { kind: 'link' }>): string {
  return `/admin/shows/${showId}/${action.href.replace(/^\/+/, '')}`;
}

/** The anchor a highlighted field carries, so the step's list can scroll to it. */
export function checkAnchorId(checkId: string): string {
  return `bill-check-${checkId}`;
}

/** Who raised it, in words: the reader of the bill (a doubt, or something it
 *  found no place for), or the app's own look at what it made of the read. */
export function sourceLabel(check: BillCheck): string {
  return check.source === 'bill' ? 'From the reader' : "GaitDesk's check";
}
