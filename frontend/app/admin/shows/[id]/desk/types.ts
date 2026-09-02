/**
 * Shapes for `GET /shows/{id}/desk` — see `backend/routers/show_desk.py`.
 *
 * The desk reads everything in one payload because it is worked at a counter
 * with a queue behind it: clicking down the roster must not fire five requests
 * per exhibitor.
 */
import type { VerificationCheck } from './CheckRow';

export type HealthStatus = 'valid' | 'missing' | 'undated' | 'expired';

/** Whether anyone at this show has physically looked at the paper.
 *
 *  Separate from the health status because they answer different questions and
 *  can disagree in both directions. The documents on file say whether the date
 *  is still good; only a person at the counter says whether the paper is
 *  genuine, present, and describes *this* horse. */
export interface HealthInspection {
  status: 'unverified' | 'verified' | 'stale';
  verification_id: string | null;
  verified_by_name: string | null;
  verified_at: string | null;
  /** The expiry staff read off the paper they were handed. This is what lets an
   *  inspection clear a flag rather than merely note that somebody looked. */
  attested_expiry: string | null;
  note: string | null;
}

/** One required health document: what the file says, and what the office saw.
 *  `status` is derived from the documents on file and judged against the show's
 *  last day — it clears itself when a current document is uploaded. Only the
 *  documents this show actually requires appear. */
export interface HorseHealthCheck {
  code: 'COGGINS' | 'VACCINATION' | 'HEALTH_CERTIFICATE';
  label: string;
  status: HealthStatus;
  message: string;
  expiry_date: string | null;
  /** True when this reads `valid` because the office inspected paper rather
   *  than because a document is uploaded. Never let a screen imply the app
   *  holds a scan it has never been shown. */
  attested: boolean;
  /** The show office's own words on what it requires — vaccinations only. */
  notes: string | null;
  inspection?: HealthInspection;
}

export interface DeskHorse {
  horse_id: string;
  horse_name: string;
  barn_name: string | null;
  age_check: VerificationCheck;
  registrations: VerificationCheck[];
  health?: HorseHealthCheck[];
}

/** One waiver and whether this exhibitor has signed it. Not a
 *  `VerificationCheck`: there is no value to hold a signature against, so
 *  nothing here can go stale the way a registration number can. */
export interface WaiverCheck {
  waiver_id: string;
  title: string;
  is_required: boolean;
  status: 'signed' | 'unsigned';
  signed_name: string | null;
  signed_at: string | null;
  on_paper: boolean;
  signed_by_guardian: boolean;
  guardian_relationship: string | null;
  recorded_by_name: string | null;
}

/** Read off the exhibitor profile, never copied per show. */
export interface EmergencyContact {
  status: 'on_file' | 'missing';
  name: string | null;
  phone: string | null;
}

export interface DeskClass {
  id: string;
  class_number: string;
  class_name: string;
  class_date: string;
  status: string;
  score_type: string;
  entry_fee_cents: number;
  discipline_name: string | null;
  division_name: string | null;
  entry_count: number;
}

export interface DeskSidePot {
  id: string;
  name: string;
  /** The buy-in. Not the class fee, and must not be labelled as one. */
  entry_fee_cents: number;
  status: string;
  entry_count: number;
}

export interface DeskEntry {
  entry_id: string;
  class_id: string;
  class_number: string | null;
  class_name: string | null;
  class_date: string | null;
  horse_id: string | null;
  horse_name: string | null;
  barn_name: string | null;
  owner_name: string | null;
  sire_name: string | null;
  dam_name: string | null;
  apha_division: string | null;
  is_disqualified: boolean;
}

export interface DeskExhibitor {
  exhibitor_id: string;
  exhibitor_name: string;
  /** NULL until they have a `show_entries` row. A back number and a side pot
   *  entry both hang off that row, which is why the desk creates one first. */
  show_entry_id: string | null;
  back_number: number | null;
  /** What the exhibitor asked for at registration (migration 104). Shown only
   *  when it differs from `back_number` — a granted request needs no comment,
   *  an overridden one is worth staff seeing before somebody asks at the desk. */
  preferred_back_number: number | null;
  signed_up: boolean;
  /** Set when the registration was called off (migration 126) — by the
   *  exhibitor outside the two-week notice window, or by staff inside it. They
   *  stay on the roster because their payments do, and a cancelled exhibitor
   *  nobody can find on the desk is one nobody can refund. */
  cancelled_at: string | null;
  /** What they asked for when it comes to stabling — "put me next to the Smith
   *  barn" (migration 128). Its own field rather than a sentence inside the
   *  general notes, because whoever draws the stall chart reads every one of
   *  these together and nothing else. */
  stall_request: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  entries: DeskEntry[];
  side_pot_ids: string[];
  memberships: VerificationCheck[];
  horses: DeskHorse[];
  waivers: WaiverCheck[];
  emergency_contact: EmergencyContact;
  paperwork_outstanding: number;
  billed_cents: number;
  net_paid_cents: number;
  /** Positive means they owe the show; negative means they have overpaid. */
  balance_cents: number;
}

export interface DeskTotals {
  exhibitors: number;
  entries: number;
  classes: number;
  no_back_number: number;
  no_entries: number;
  paperwork_outstanding: number;
  health_alerts: number;
  waivers_outstanding: number;
  contacts_missing: number;
}

export interface Desk {
  show_id: string;
  show_name: string;
  show_status: string;
  show_type_code: string | null;
  classes: DeskClass[];
  side_pots: DeskSidePot[];
  exhibitors: DeskExhibitor[];
  totals: DeskTotals;
}

/** A horse on the exhibitor's own profile — what the class picker offers. */
export interface ProfileHorse {
  id: string;
  name: string;
  barn_name?: string | null;
  is_solid_paint_bred?: boolean;
}

export const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  accent: '#8b4513',
  border: '#d4b896',
  borderSoft: '#f0e6d6',
  surface: '#ffffff',
  surfaceSoft: '#faf7f2',
  dark: '#2c1810',
  onDark: '#f5ede0',
} as const;

/** The paperwork problems, not the unfinished sign-offs. A lapsed Coggins is
 *  something to chase the exhibitor about; an uninspected one is something the
 *  desk still has to do, and that is already in `paperwork_outstanding`. */
export function healthAlerts(exhibitor: DeskExhibitor): HorseHealthCheck[] {
  return exhibitor.horses.flatMap((h) => (h.health ?? []).filter((c) => c.status !== 'valid'));
}

/** Required waivers this exhibitor has not signed by either route. */
export function unsignedWaivers(exhibitor: DeskExhibitor): WaiverCheck[] {
  return (exhibitor.waivers ?? []).filter((w) => w.is_required && w.status !== 'signed');
}

/** Local-midnight parse so a plain YYYY-MM-DD does not shift a day west of UTC. */
export function formatShowDate(d: string | null | undefined): string {
  if (!d) return 'Unscheduled';
  const dt = new Date(`${d}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}
