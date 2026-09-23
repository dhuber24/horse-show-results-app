/**
 * Shapes for `GET /shows/{id}/desk` — see `backend/routers/show_desk.py`.
 *
 * The desk reads everything in one payload because it is worked at a counter
 * with a queue behind it: clicking down the roster must not fire five requests
 * per exhibitor.
 */
import type { VerificationCheck } from './CheckRow';
import type { Bill, BillFuturityLine } from '@/lib/my-shows';

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
  /** Set on a futurity's release, which the desk records with one "signed
   *  release on file" tick rather than a transcribed name. */
  futurity_id: string | null;
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

/** How the office reaches this exhibitor away from the counter. Read off their
 *  profile, never copied per show — the same call the emergency contact makes.
 *  Nothing here is a check and none of it counts as paperwork outstanding. */
export interface ExhibitorContact {
  /** The account's address where there is an account, otherwise the one the
   *  office wrote down (migration 140). */
  email: string | null;
  /** Which of the two `email` came from — "the address they sign in with" and
   *  "the address on their entry blank" are different promises about whether a
   *  message actually arrives. */
  email_source: 'account' | 'office' | null;
  /** Set only when the office recorded a *different* address from the
   *  account's. Either the better one or a typo, and both are worth seeing. */
  office_email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** A youth exhibitor is reached through their guardian — who you ring first,
   *  as against the emergency contact, who you ring if something happens. */
  guardian_name: string | null;
  guardian_phone: string | null;
  has_any: boolean;
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
  /** The APHA division an entry in this class is filed under, read off its
   *  bracket — decided when the class was built, so the desk states it rather
   *  than asking. Null at a non-APHA show, and where the class does not say. */
  apha_division: string | null;
  entry_count: number;
}

export interface DeskSidePot {
  id: string;
  name: string;
  /** The buy-in. Not the class fee, and must not be labelled as one. */
  entry_fee_cents: number;
  status: string;
  entry_count: number;
  /** The classes this pot bundles. Entering one of them means buying in, so
   *  the entry form reads this to ask for the buy-in on the classes that
   *  oblige it. `?? []` at every use: a frontend deployed ahead of the backend
   *  that adds the field should ask for nothing rather than break the desk. */
  class_ids?: string[];
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
  /** Their email, phone and address, for reaching them away from the counter.
   *  Show-office tier by virtue of the endpoint — the desk is ADMIN /
   *  SHOW_MANAGER / SHOW_SECRETARY, and no scribe or gate steward screen
   *  reads this payload. */
  contact: ExhibitorContact;
  paperwork_outstanding: number;
  billed_cents: number;
  net_paid_cents: number;
  /** Positive means they owe the show; negative means they have overpaid. */
  balance_cents: number;
  /** The itemised bill behind `billed_cents` — the same one Financials shows.
   *  The Classes section quotes it rather than adding up `entry_fee_cents`,
   *  which reads $0 for every futurity class. */
  bill: Bill | null;
  /** Payment rows on the account, refunds included. Any at all and the
   *  registration can be cancelled but not removed — removing it would delete
   *  the record of money that moved. */
  payment_count: number;
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
  /** Whether this show asks for the health originals at the counter
   *  (migration 138). The health rows are listed either way — the office may
   *  still record a paper it was handed — but when false the sign-off is
   *  optional and is not in `paperwork_outstanding`. */
  requires_physical_document_check: boolean;
  /** The day health paperwork has to still be good for — the show's last day.
   *  An inspection whose attested expiry stops before this does not clear the
   *  horse, so the form says so while the date is being typed. Nullable for a
   *  frontend deployed ahead of the backend that adds it. */
  paperwork_deadline?: string | null;
  classes: DeskClass[];
  side_pots: DeskSidePot[];
  futurities: DeskFuturity[];
  exhibitors: DeskExhibitor[];
  totals: DeskTotals;
}

export interface DeskFuturityPrice {
  id: string;
  name: string;
  amount_cents: number;
}

/** A futurity as the desk needs it: which classes it prices, and what enrolling
 *  a horse asks. The enrollments themselves are on each exhibitor's bill. */
export interface DeskFuturity {
  id: string;
  name: string;
  class_ids: string[];
  fee_tiers: DeskFuturityPrice[];
  membership_options: DeskFuturityPrice[];
  office_fee_member_cents: number;
  office_fee_nonmember_cents: number;
  late_fee_cents: number;
  entry_deadline: string | null;
}

/** The futurity that prices this class, if any. */
export function futurityForClass(desk: Desk, classId: string): DeskFuturity | undefined {
  // `?? []` so a frontend deployed ahead of the backend that adds the field
  // reads "no futurities" rather than taking the desk down.
  return (desk.futurities ?? []).find((f) => f.class_ids.includes(classId));
}

/** This exhibitor's enrollment of one horse in one futurity, off their bill. */
export function futurityEnrollment(
  exhibitor: DeskExhibitor | undefined,
  futurityId: string,
  horseId: string | null,
): BillFuturityLine | undefined {
  if (!exhibitor || !horseId) return undefined;
  return (exhibitor.bill?.futurity_lines ?? []).find(
    (l) => l.futurity_id === futurityId && l.horse_id === horseId,
  );
}

/**
 * Horses this exhibitor has put in a futurity's classes without enrolling them
 * in the futurity.
 *
 * A futurity class carries no fee of its own — the enrollment's category is
 * the price — so an entry like this is billed nothing, and the desk's total
 * silently reads short. One row per (futurity, horse), with how many of its
 * classes the horse is in.
 */
export function unenrolledFuturityHorses(
  desk: Desk,
  exhibitor: DeskExhibitor,
): { futurity: DeskFuturity; horseId: string; horseName: string; classCount: number }[] {
  const found = new Map<
    string,
    { futurity: DeskFuturity; horseId: string; horseName: string; classCount: number }
  >();
  for (const entry of exhibitor.entries) {
    if (!entry.horse_id) continue;
    const futurity = futurityForClass(desk, entry.class_id);
    if (!futurity || futurityEnrollment(exhibitor, futurity.id, entry.horse_id)) continue;
    const key = `${futurity.id}|${entry.horse_id}`;
    const row = found.get(key) ?? {
      futurity,
      horseId: entry.horse_id,
      horseName: entry.horse_name ?? 'This horse',
      classCount: 0,
    };
    row.classCount += 1;
    found.set(key, row);
  }
  return Array.from(found.values());
}

/** The lowest back number nobody else at the show holds or has asked for —
 *  the same rule the backend assigns at sign-up. */
export function nextFreeBackNumber(desk: Desk, exceptExhibitorId: string): number {
  const taken = new Set<number>();
  for (const e of desk.exhibitors) {
    if (e.exhibitor_id === exceptExhibitorId) continue;
    if (e.back_number != null) taken.add(e.back_number);
    if (e.preferred_back_number != null) taken.add(e.preferred_back_number);
  }
  let n = 1;
  while (taken.has(n)) n += 1;
  return n;
}

/** A horse on the exhibitor's own profile — what the class picker offers. */
export interface ProfileHorse {
  id: string;
  name: string;
  barn_name?: string | null;
}

export const COLORS = {
  text: 'var(--foreground)',
  muted: 'var(--muted)',
  accent: 'var(--accent)',
  border: 'var(--border)',
  borderSoft: 'var(--bg-subtle)',
  surface: 'var(--surface)',
  surfaceSoft: 'var(--background)',
  dark: 'var(--foreground)',
  onDark: 'var(--bg-subtle)',
} as const;

/**
 * The open side pots that bundle this class.
 *
 * A pot is only a condition of entering while it is open: a settled pot has its
 * payouts written and refuses new entries, so requiring it would make the class
 * unenterable by anybody — see `backend/side_pot_membership.py`, which is where
 * the rule actually lives. This is the affordance.
 */
export function potsForClass(desk: Desk, classId: string): DeskSidePot[] {
  return desk.side_pots.filter(
    (pot) => pot.status === 'open' && (pot.class_ids ?? []).includes(classId),
  );
}

/**
 * The pots this exhibitor must buy into before entering this class — empty when
 * no pot covers it, or when they are already in one that does.
 *
 * "One that does", not all of them: a class two pots have bundled is a choice
 * the show meant somebody to make, and charging both buy-ins for one entry
 * would be charging twice for it.
 */
export function unmetPotsForClass(
  desk: Desk,
  exhibitor: DeskExhibitor | undefined,
  classId: string,
): DeskSidePot[] {
  const covering = potsForClass(desk, classId);
  if (covering.length === 0) return [];
  const joined = new Set(exhibitor?.side_pot_ids ?? []);
  return covering.some((pot) => joined.has(pot.id)) ? [] : covering;
}

/** One health problem, and which horse has it. The horse comes along because
 *  the panel's warning at the top is a jump link: "no Coggins on file" is not
 *  actionable until you know whose, and the row to scroll to is keyed on the
 *  horse. */
export interface HealthAlert {
  horse_id: string;
  horse_name: string;
  check: HorseHealthCheck;
}

/** The paperwork problems, not the unfinished sign-offs. A lapsed Coggins is
 *  something to chase the exhibitor about; an uninspected one is something the
 *  desk still has to do, and that is already in `paperwork_outstanding`. */
export function healthAlerts(exhibitor: DeskExhibitor): HealthAlert[] {
  return exhibitor.horses.flatMap((h) =>
    (h.health ?? [])
      .filter((c) => c.status !== 'valid')
      .map((check) => ({ horse_id: h.horse_id, horse_name: h.horse_name, check })),
  );
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
