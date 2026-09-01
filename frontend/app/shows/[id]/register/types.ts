/**
 * Shape of `GET /shows/{id}/register/preview`, shared by the registration
 * screen and the entry form beside it.
 *
 * Split out of `RegisterShowForm` when the screen was rebuilt around the show
 * office's own entry form: both halves read the same class list, the same
 * horses, and the same set of entries already filed, and a second copy of those
 * types is the kind of pair that drifts.
 */

import type { Bill } from '@/lib/my-shows';

export type PreviewClass = {
  id: string;
  class_number: string;
  class_name: string;
  class_date: string;
  /** `pattern` classes are judged run by run, so one exhibitor may show two
   *  horses in them. Everything else is once per exhibitor. */
  score_type: string;
  entry_fee_cents: number;
  sanctioning_codes: string[];
  sanction_cents: number;
};

export type HealthCheck = {
  code: string;
  label: string;
  status: 'valid' | 'missing' | 'undated' | 'expired';
  message: string;
  expiry_date: string | null;
  /** True when this is only `valid` because the show office inspected the paper
   *  at the desk. Nothing is uploaded, so the *next* show will ask again — but
   *  this one has seen it, and nagging about paperwork the office is holding is
   *  how people learn to ignore a warning. */
  attested?: boolean;
};

export type PreviewHorse = {
  id: string;
  name: string;
  /** Only meaningful at an APHA show — a Solid Paint-Bred horse may not enter
   *  an Open division class. */
  is_solid_paint_bred: boolean;
  /** Advisory, never a gate — see `healthWarnings`. */
  health?: HealthCheck[];
};

export type ExistingEntry = { id: string; class_id: string; horse_id: string | null };

export type Signup = {
  show_entry_id: string;
  registered_at: string;
  back_number: number | null;
  /** What they asked for. Diverges from `back_number` once the office
   *  renumbers, which is the case the screen calls out. */
  preferred_back_number: number | null;
  arrival_date: string | null;
  departure_date: string | null;
  notes: string | null;
  reservations: { show_fee_id: string; quantity: number }[];
};

/** One line of the step-one checklist, straight from `exhibitor_profile.py`.
 *  `blocking` false is a prompt the exhibitor may ignore — currently only the
 *  association memberships, which the desk verifies against a card anyway. */
export type ProfileChecklistItem = {
  key: string;
  label: string;
  complete: boolean;
  blocking: boolean;
  hint: string;
};

/**
 * Step one of registration.
 *
 * `complete` is the backend's own answer and the same one `PUT /signup`
 * refuses on — never recomputed here, so the lock on the screen and the
 * refusal from the endpoint cannot drift apart.
 */
export type ProfileStatus = {
  complete: boolean;
  missing: string[];
  checklist: ProfileChecklistItem[];
  exhibitor: {
    id: string;
    full_name: string;
    date_of_birth: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    emergency_contact_name: string | null;
    emergency_contact_phone: string | null;
    parent_guardian_name: string | null;
    parent_guardian_phone: string | null;
  };
};

/**
 * Whether cancelling is still the exhibitor's own to do.
 *
 * `self_service` is the only field that decides anything; the rest is so the
 * screen can say *why* without recomputing the two-week rule and drifting from
 * `cancellations.py`.
 */
export type CancellationWindow = {
  notice_days: number;
  /** The last day the exhibitor may cancel themselves, `YYYY-MM-DD`. */
  deadline: string | null;
  self_service: boolean;
  days_until_show: number | null;
};

export type PreviewData = {
  /** Null until the exhibitor completes show sign-up. The POST rejects class
   *  entries without it, so the form refuses to render the picker rather than
   *  letting someone fill it in and be turned away on submit. */
  signup: Signup | null;
  /** Step one. The stalls half is locked on this the same way the classes half
   *  is locked on `signup`. */
  profile: ProfileStatus;
  cancellation: CancellationWindow;
  show: {
    id: string;
    name: string;
    status: string;
    start_date: string;
    end_date: string;
    show_type_code: string | null;
    office_charge_cents: number;
    office_charge_basis: string;
  };
  exhibitor: { id: string; full_name: string };
  classes: PreviewClass[];
  horses: PreviewHorse[];
  existing_entries: ExistingEntry[];
  /** From `billing.build_bill` — never re-derived here. See Claude.md. */
  bill: Bill;
};

export function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/**
 * What this horse still needs before the show — not before registering.
 *
 * A lapsed Coggins used to stop the entry going in at all, which helped nobody:
 * the paperwork was no more current for the horse having been turned away, and
 * the show office only found out when the trailer arrived. The entry goes
 * through, the exhibitor sees this, and the office sees the same list on its
 * own screen with time to chase it.
 */
export function healthWarnings(horse: PreviewHorse): string[] {
  return (horse.health ?? [])
    .filter((check) => check.status !== 'valid')
    .map((check) => check.message);
}
