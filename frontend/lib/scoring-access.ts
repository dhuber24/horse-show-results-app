/**
 * Who does a scribe's work at a show — entering placings and scores, posting a
 * class, the judge's card and its photo — and so who is offered the scribe
 * screens.
 *
 * ADMIN and SCRIBE at every show; a show manager or secretary at the shows
 * they work. The backend's `show_access.require_scoring_access` is the
 * enforcement; this only decides what to offer. Client-safe and session-free,
 * so `proxy.ts` can read the role list.
 */
import type { ShowPlan } from '@/lib/show-companies';

/** Every role that may open a scribe screen at all. */
export const SCORING_ROLES = ['ADMIN', 'SCRIBE', 'SHOW_MANAGER', 'SHOW_SECRETARY'];

const SHOW_OFFICE_ROLES = ['SHOW_MANAGER', 'SHOW_SECRETARY'];

/** Whether this role works a show through its office, and so needs the show's
 *  plan fetched before it is offered the scribe screens there. */
export function isShowOfficeRole(role: string | undefined): boolean {
  return SHOW_OFFICE_ROLES.includes(role ?? '');
}

/**
 * Whether to offer this caller the scribe screens at a show.
 *
 * A show manager or secretary is offered them only where the show's plan
 * answered (`fetchShowPlan`) — `/plan` answers the show's own office and
 * nobody else — so a secretary from another company is not shown a door that
 * every save behind it would refuse.
 */
export function mayScore(role: string | undefined, plan: ShowPlan | null): boolean {
  if (role === 'ADMIN' || role === 'SCRIBE') return true;
  return isShowOfficeRole(role) && plan !== null;
}
