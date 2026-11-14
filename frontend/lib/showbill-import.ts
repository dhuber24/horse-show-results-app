/**
 * A show read off its own show bill, between the read and the show (migration 187).
 *
 * The backend reads the bill (`extraction/showbill.py`) and matches it against
 * the app (`showbill_import.prepare_draft`). Once the read is in, the person
 * confirms the four values a show row cannot exist without — name, breed
 * association, dates — and presses Create: the show is made as a DRAFT and
 * every doubt about the read becomes a check on its setup step
 * (`showbill_checks.py`, `lib/bill-checks.ts`). This module is that page's
 * state: what the read said, and what pressing Create will make of it.
 *
 * Kept apart from the component so the form's starting values and the summary
 * are testable without rendering anything.
 */

import type { ClubSanctionUnit, FeeUnit } from '@/lib/fee-units';

// ── What the backend returns ────────────────────────────────────────────────

/** A field of the show the reader named in a doubt (`SHOW_CHECK_FIELDS`). */
export type ShowCheckField =
  | 'name'
  | 'start_date'
  | 'end_date'
  | 'entry_deadline'
  | 'breed_association'
  | 'apha_show_number'
  | 'aqha_show_number'
  | 'apha_zone'
  | 'venue'
  | 'requires_coggins'
  | 'requires_health_certificate'
  | 'requires_vaccination'
  | 'shavings_ban_outside';

export type ExtractedShow = {
  name: string | null;
  start_date: string | null;
  end_date: string | null;
  entry_deadline: string | null;
  breed_association: string | null;
  apha_show_number: string | null;
  aqha_show_number: string | null;
  apha_zone: number | null;
  venue_name: string | null;
  venue_address: string | null;
  venue_city: string | null;
  venue_state: string | null;
  shavings_ban_outside: boolean | null;
  requires_coggins: boolean | null;
  requires_health_certificate: boolean | null;
  health_certificate_valid_days: number | null;
  requires_vaccination: boolean | null;
  staff: { role: string; name: string }[];
};

export type ExtractedJudge = {
  first_name: string;
  last_name: string;
  location: string | null;
  associations: string[];
  check?: string | null;
};

export type ExtractedClub = {
  code: string;
  name: string | null;
  fee_amount_cents: number | null;
  fee_unit: ClubSanctionUnit | null;
  fee_text: string | null;
  check?: string | null;
};

export type ExtractedRate = {
  key: string;
  label: string;
  amount_cents: number;
  per_judge: boolean;
  association_code: string | null;
  printed_text: string | null;
  check?: string | null;
};

export type ExtractedClass = {
  date: string | null;
  number: string | null;
  name: string;
  discipline: string | null;
  bracket: string | null;
  association_class_code: string | null;
  rate_key: string | null;
  club_codes: string[];
  is_championship: boolean;
  is_futurity: boolean;
  note: string | null;
};

export type ExtractedFee = {
  label: string;
  amount_cents: number;
  unit: FeeUnit;
  notes: string | null;
  early_amount_cents: number | null;
  early_deadline: string | null;
  min_quantity: number | null;
  check?: string | null;
};

export type ExtractedShowbill = {
  show: ExtractedShow;
  judges: ExtractedJudge[];
  clubs: ExtractedClub[];
  class_rates: ExtractedRate[];
  classes: ExtractedClass[];
  fees: ExtractedFee[];
  /** Missing on a read from before migration 187. */
  show_checks?: { field: ShowCheckField; message: string }[];
  /** A bare string on a read from before migration 187. */
  not_imported: ({ topic: string; text: string } | string)[];
  warnings: string[];
};

export type ResolvedShowbill = {
  show_type_id: string | null;
  venue_id: string | null;
  judges: {
    suggested_judge_id: string | null;
    candidate_judge_ids: string[];
    matched_on: string | null;
    association_ids: string[];
  }[];
  clubs: { association_id: string | null; is_breed_association: boolean }[];
  classes: {
    discipline: string;
    score_type: string;
    entered_by_qualification: boolean;
    club_association_ids: string[];
    unknown_club_codes: string[];
  }[];
};

export type ShowBillImport = {
  id: string;
  status: 'pending' | 'succeeded' | 'failed' | 'unsupported_media';
  message: string | null;
  original_filename: string;
  created_at: string | null;
  completed_at: string | null;
  show_id: string | null;
  extracted: ExtractedShowbill | null;
  resolved: ResolvedShowbill | null;
};

// ── The four values a show cannot be created without ────────────────────────

export type StartForm = {
  name: string;
  show_type_id: string;
  start_date: string;
  end_date: string;
  attach_showbill: boolean;
};

/** What the bill said, with the breed body matched — or Open, when the bill
 *  names none, since an open show is what a bill without one is. */
export function startDefaults(imp: ShowBillImport, openShowTypeId: string | null): StartForm {
  const s = imp.extracted?.show;
  return {
    name: s?.name ?? '',
    show_type_id: imp.resolved?.show_type_id ?? openShowTypeId ?? '',
    start_date: s?.start_date ?? '',
    end_date: s?.end_date ?? '',
    attach_showbill: true,
  };
}

/** Every reason the form cannot be sent yet, in the order the boxes appear. */
export function startProblems(form: StartForm): string[] {
  const problems: string[] = [];
  if (!form.name.trim()) problems.push('The show needs a name.');
  if (!form.show_type_id) problems.push('Pick the breed association the show runs under (or Open).');
  if (!form.start_date || !form.end_date) problems.push('The show needs a start and an end date.');
  else if (form.end_date < form.start_date) problems.push('The end date is before the start date.');
  return problems;
}

/** The reader's doubts about one of the boxes on the page, word for word. */
export function readerDoubts(imp: ShowBillImport, field: ShowCheckField): string[] {
  return (imp.extracted?.show_checks ?? []).filter((c) => c.field === field).map((c) => c.message);
}

// ── What Create will make ───────────────────────────────────────────────────

export type ReadSummary = {
  classes: number;
  days: number;
  judges: number;
  /** Judges on the bill the registry holds exactly one of — attached, and
   *  still a check. The rest are left for the Judges step. */
  judgesMatched: number;
  clubs: number;
  /** Clubs the registry lacks, which cannot be attached. */
  clubsUnknown: number;
  fees: number;
  venueMatched: boolean;
  venueNamed: boolean;
  /** Things the reader itself was unsure of. The app adds its own checks on
   *  top when the show is created, so this is a floor, not the count. */
  readerDoubts: number;
};

export function readSummary(imp: ShowBillImport): ReadSummary | null {
  const x = imp.extracted;
  const r = imp.resolved;
  if (!x || !r) return null;
  const notBreed = r.clubs.filter((c) => !c.is_breed_association);
  return {
    classes: x.classes.length,
    days: new Set(x.classes.map((c) => c.date).filter(Boolean)).size,
    judges: x.judges.length,
    judgesMatched: r.judges.filter((j) => j.suggested_judge_id).length,
    clubs: notBreed.length,
    clubsUnknown: notBreed.filter((c) => !c.association_id).length,
    fees: x.fees.length,
    venueMatched: Boolean(r.venue_id),
    venueNamed: Boolean(x.show.venue_name),
    readerDoubts:
      x.warnings.length +
      (x.show_checks?.length ?? 0) +
      x.classes.filter((c) => c.note).length +
      [...x.judges, ...x.clubs, ...x.class_rates, ...x.fees].filter((i) => i.check).length,
  };
}
