/**
 * A show read off its own show bill, between the read and the show.
 *
 * The backend reads the bill (`extraction/showbill.py`), matches it against the
 * app (`showbill_import.prepare_draft`) and drafts two notes from it
 * (`showbill_draft.py`). The confirm page settles what a read cannot: the four
 * values a show row cannot exist without, who each judge the bill names *is*,
 * which venue it is held at, and the notes themselves. Create then makes the
 * show as a DRAFT, filled in as far as the bill allows — futurities and side
 * pots included — with nothing left to Accept: what to look at is in its
 * office notes.
 *
 * Kept apart from the component so the form's starting values, what it refuses
 * to send and what it sends are testable without rendering anything.
 */

import type { ClubSanctionUnit, FeeUnit } from '@/lib/fee-units';

// ── What the backend returns ────────────────────────────────────────────────

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
  /** Missing on a read from before 2026-11-15. */
  venue_zip?: string | null;
  shavings_ban_outside: boolean | null;
  requires_coggins: boolean | null;
  requires_health_certificate: boolean | null;
  health_certificate_valid_days: number | null;
  requires_vaccination: boolean | null;
  /** Each note for the step that holds it (2026-11-18): Paperwork's... */
  vaccination_notes?: string | null;
  /** ...and the stall rules every period shares, on the Lodging step's
   *  first stall period. */
  stall_notes?: string | null;
  /** A read from before stall periods were read (2026-11-18) gave one move-in. */
  stalls_move_in_date?: string | null;
};

/** A window the bill sells stalls for (2026-11-18); only the name is read here. */
export type ExtractedStallPeriod = {
  name: string;
  stalls: { kind: 'box' | 'tie' | 'tack'; amount_cents: number }[];
};

export type ExtractedJudge = {
  first_name: string;
  last_name: string;
  associations: string[];
};

export type ExtractedClub = {
  code: string;
  name: string | null;
  fee_amount_cents: number | null;
  fee_unit: ClubSanctionUnit | null;
  fee_text: string | null;
};

export type ExtractedRate = {
  key: string;
  label: string;
  amount_cents: number;
  per_judge: boolean;
  association_code: string | null;
  printed_text: string | null;
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
  /** The futurity it is part of. Missing on a read from before 2026-11-15. */
  futurity?: string | null;
  side_pots?: string[];
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
};

export type ExtractedShowbill = {
  show: ExtractedShow;
  judges: ExtractedJudge[];
  clubs: ExtractedClub[];
  class_rates: ExtractedRate[];
  classes: ExtractedClass[];
  fees: ExtractedFee[];
  /** Missing on a read from before 2026-11-15. */
  futurities?: { name: string }[];
  side_pots?: { name: string }[];
  /** Missing on a read from before 2026-11-18. */
  stall_periods?: ExtractedStallPeriod[];
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

export type DraftedNotes = {
  public_notes: string | null;
  office_notes: string | null;
};

export type ShowBillImport = {
  id: string;
  status: 'pending' | 'succeeded' | 'failed' | 'unsupported_media';
  message: string | null;
  original_filename: string;
  /** Supporting documents read with the bill, in the order chosen (migration 201). */
  supporting_filenames?: string[];
  created_at: string | null;
  completed_at: string | null;
  show_id: string | null;
  extracted: ExtractedShowbill | null;
  resolved: ResolvedShowbill | null;
  drafted?: DraftedNotes | null;
};

/** The directories the confirm page searches. */
export type DirectoryJudge = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  associations: { id: string; code: string }[];
};

export type DirectoryVenue = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip?: string | null;
};

// ── What the confirm page settles ───────────────────────────────────────────

export type NewJudge = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  association_ids: string[];
};

/** Who one judge the bill names is: somebody in the directory, somebody to
 *  add, nobody (a name misread as a judge), or not settled yet. */
export type JudgeChoice =
  | { kind: 'directory'; judge_id: string }
  | ({ kind: 'new' } & NewJudge)
  | { kind: 'leave_off' }
  | { kind: 'unsettled' };

export type NewVenue = { name: string; address: string; city: string; state: string; zip: string };

export type VenueChoice = { kind: 'directory'; venue_id: string } | ({ kind: 'new' } & NewVenue) | { kind: 'none' };

export type StartForm = {
  name: string;
  show_type_id: string;
  start_date: string;
  end_date: string;
  attach_showbill: boolean;
  judges: JudgeChoice[];
  venue: VenueChoice;
  public_notes: string;
  office_notes: string;
};

export const PUBLIC_NOTES_MAX = 5000;
export const OFFICE_NOTES_MAX = 20000;

/** A new judge filled in from what the bill printed: the name, and the cards
 *  the bill names that the app knows. */
export function newJudgeFromBill(imp: ShowBillImport, index: number): NewJudge {
  const j = imp.extracted?.judges[index];
  return {
    first_name: j?.first_name ?? '',
    last_name: j?.last_name ?? '',
    email: '',
    phone: '',
    association_ids: imp.resolved?.judges[index]?.association_ids ?? [],
  };
}

/** A new venue filled in from what the bill printed. */
export function newVenueFromBill(imp: ShowBillImport): NewVenue {
  const s = imp.extracted?.show;
  return {
    name: s?.venue_name ?? '',
    address: s?.venue_address ?? '',
    city: s?.venue_city ?? '',
    state: s?.venue_state ?? '',
    zip: s?.venue_zip ?? '',
  };
}

/** What the bill said, with the breed body matched — or Open, when the bill
 *  names none, since an open show is what a bill without one is. A judge or a
 *  venue starts settled only where exactly one directory entry has its name. */
export function startDefaults(imp: ShowBillImport, openShowTypeId: string | null): StartForm {
  const s = imp.extracted?.show;
  const judges = imp.extracted?.judges ?? [];
  return {
    name: s?.name ?? '',
    show_type_id: imp.resolved?.show_type_id ?? openShowTypeId ?? '',
    start_date: s?.start_date ?? '',
    end_date: s?.end_date ?? '',
    attach_showbill: true,
    judges: judges.map((_, i) => {
      const id = imp.resolved?.judges[i]?.suggested_judge_id;
      return id ? { kind: 'directory', judge_id: id } : { kind: 'unsettled' };
    }),
    venue: imp.resolved?.venue_id ? { kind: 'directory', venue_id: imp.resolved.venue_id } : { kind: 'none' },
    public_notes: imp.drafted?.public_notes ?? '',
    office_notes: imp.drafted?.office_notes ?? '',
  };
}

/** Whether the bill names a venue somebody has to settle. */
export function billNamesVenue(imp: ShowBillImport): boolean {
  return Boolean(imp.extracted?.show.venue_name);
}

/** Every reason the form cannot be sent yet, in the order the page shows them.
 *  `canAddVenue` is a show manager or an admin: only they may add a venue, so
 *  only they are held to settling one — a secretary may leave it blank. */
export function startProblems(form: StartForm, imp: ShowBillImport, canAddVenue: boolean): string[] {
  const problems: string[] = [];
  if (!form.name.trim()) problems.push('The show needs a name.');
  if (!form.show_type_id) problems.push('Pick the breed association the show runs under (or Open).');
  if (!form.start_date || !form.end_date) problems.push('The show needs a start and an end date.');
  else if (form.end_date < form.start_date) problems.push('The end date is before the start date.');

  const billJudges = imp.extracted?.judges ?? [];
  form.judges.forEach((choice, i) => {
    const printed = billJudges[i] ? `${billJudges[i].first_name} ${billJudges[i].last_name}` : `Judge ${i + 1}`;
    if (choice.kind === 'unsettled') {
      problems.push(`Find ${printed} in the judge directory, add them, or leave them off.`);
    } else if (choice.kind === 'new') {
      if (!choice.first_name.trim() || !choice.last_name.trim()) problems.push(`A new judge needs a first and last name.`);
      if (!choice.email.trim() && !choice.phone.trim()) {
        problems.push(`Add an email or a phone for ${printed}: it is how the directory tells two judges of one name apart.`);
      }
    }
  });
  const picked = form.judges.flatMap((c) => (c.kind === 'directory' ? [c.judge_id] : []));
  if (new Set(picked).size !== picked.length) problems.push('The same judge is picked twice.');

  if (form.venue.kind === 'none' && billNamesVenue(imp) && canAddVenue) {
    problems.push(`Find ${imp.extracted?.show.venue_name} in the venue directory, or add it.`);
  } else if (form.venue.kind === 'new') {
    const v = form.venue;
    if (![v.name, v.address, v.city, v.state, v.zip].every((x) => x.trim())) {
      problems.push('A new venue needs its name and full address: street, city, state and ZIP.');
    }
  }

  if (form.public_notes.length > PUBLIC_NOTES_MAX) {
    problems.push(`The show notes are over ${PUBLIC_NOTES_MAX.toLocaleString()} characters.`);
  }
  if (form.office_notes.length > OFFICE_NOTES_MAX) {
    problems.push(`The office notes are over ${OFFICE_NOTES_MAX.toLocaleString()} characters. Download them, then shorten them.`);
  }
  return problems;
}

/** The body of `POST /show-bill-imports/{id}/create-show`. */
export function startBody(form: StartForm) {
  return {
    name: form.name.trim(),
    show_type_id: form.show_type_id,
    start_date: form.start_date,
    end_date: form.end_date,
    attach_showbill: form.attach_showbill,
    judges: form.judges.map((c) => {
      if (c.kind === 'directory') return { judge_id: c.judge_id };
      if (c.kind === 'leave_off') return { leave_off: true };
      if (c.kind === 'new') {
        return {
          new: {
            first_name: c.first_name.trim(),
            last_name: c.last_name.trim(),
            email: c.email.trim() || null,
            phone: c.phone.trim() || null,
            association_ids: c.association_ids,
          },
        };
      }
      return {};
    }),
    venue:
      form.venue.kind === 'directory'
        ? { venue_id: form.venue.venue_id }
        : form.venue.kind === 'new'
          ? { new: { name: form.venue.name, address: form.venue.address, city: form.venue.city, state: form.venue.state, zip: form.venue.zip } }
          : null,
    public_notes: form.public_notes.trim() || null,
    office_notes: form.office_notes.trim() || null,
  };
}

// ── Searching the directories ───────────────────────────────────────────────

function fold(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Directory judges for a search box, best first: the bill's own candidates
 *  (the same surname) lead while the box is empty; typed words must each
 *  appear in the name, email or phone. */
export function searchJudges(
  directory: DirectoryJudge[],
  query: string,
  candidateIds: string[] = [],
  limit = 8,
): DirectoryJudge[] {
  const words = fold(query).split(' ').filter(Boolean);
  if (words.length === 0) {
    return candidateIds.flatMap((id) => directory.filter((j) => j.id === id)).slice(0, limit);
  }
  return directory
    .filter((j) => {
      const hay = fold(`${j.first_name} ${j.last_name} ${j.email ?? ''} ${j.phone ?? ''}`);
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => Number(candidateIds.includes(b.id)) - Number(candidateIds.includes(a.id)))
    .slice(0, limit);
}

/** Directory venues for a search box: typed words must each appear in the
 *  name, street or city. */
export function searchVenues(directory: DirectoryVenue[], query: string, limit = 8): DirectoryVenue[] {
  const words = fold(query).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  return directory
    .filter((v) => {
      const hay = fold(`${v.name} ${v.address ?? ''} ${v.city ?? ''} ${v.state ?? ''}`);
      return words.every((w) => hay.includes(w));
    })
    .slice(0, limit);
}

// ── What a read was made from ───────────────────────────────────────────────

/**
 * Supporting documents beside the bill (migration 201) -- the backend's
 * `MAX_SUPPORTING_DOCUMENTS` and `MAX_UPLOAD_TOTAL_BYTES`, said before the
 * upload rather than after a round trip. Every document goes to the model in
 * one request, which is what caps the total.
 */
export const MAX_SUPPORTING_DOCUMENTS = 4;
export const MAX_UPLOAD_TOTAL_BYTES = 20 * 1024 * 1024;

/** Why the documents chosen so far cannot be uploaded together, or null. */
export function uploadSetProblem(sizes: number[]): string | null {
  const supporting = sizes.length - 1;
  if (supporting > MAX_SUPPORTING_DOCUMENTS) {
    return `Add at most ${MAX_SUPPORTING_DOCUMENTS} supporting documents beside the show bill.`;
  }
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total > MAX_UPLOAD_TOTAL_BYTES) {
    return `The documents come to more than ${MAX_UPLOAD_TOTAL_BYTES / (1024 * 1024)} MB together. Leave out the largest supporting document, or keep only the pages that matter.`;
  }
  return null;
}

/** A read's documents in one short line: "bill.pdf", or "bill.pdf + 2 more". */
export function readFilesLabel(imp: Pick<ShowBillImport, 'original_filename' | 'supporting_filenames'>): string {
  const more = imp.supporting_filenames?.length ?? 0;
  return more ? `${imp.original_filename} + ${more} more` : imp.original_filename;
}

/** Every document a read was made from, by name, as the office notes name them. */
export function readSourceNames(imp: Pick<ShowBillImport, 'original_filename' | 'supporting_filenames'>): string {
  return [imp.original_filename, ...(imp.supporting_filenames ?? [])].join(' + ');
}

// ── The notes, to keep ──────────────────────────────────────────────────────

/** Both notes as one text file, for whoever wants a copy kept off the show. */
export function notesFile(form: StartForm, filename: string): string {
  const parts = [`${form.name.trim() || 'Show'} — notes from the show bill (${filename})`];
  if (form.public_notes.trim()) parts.push('', 'SHOW NOTES (exhibitors see these)', '', form.public_notes.trim());
  if (form.office_notes.trim()) parts.push('', 'OFFICE NOTES (only the show office)', '', form.office_notes.trim());
  return parts.join('\n') + '\n';
}

// ── What Create will make ───────────────────────────────────────────────────

export type ReadSummary = {
  classes: number;
  days: number;
  judges: number;
  clubs: number;
  /** Clubs the registry lacks, which cannot be attached. */
  clubsUnknown: number;
  fees: number;
  futurities: number;
  sidePots: number;
  /** The stall periods made on Lodging, by name. */
  stallPeriods: string[];
  /** Which vaccinations, on the Paperwork step. */
  vaccinationNotes: boolean;
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
    clubs: notBreed.length,
    clubsUnknown: notBreed.filter((c) => !c.association_id).length,
    fees: x.fees.length,
    futurities: x.futurities?.length ?? 0,
    sidePots: x.side_pots?.length ?? 0,
    stallPeriods: x.stall_periods
      ? x.stall_periods.map((p) => p.name)
      : x.show.stall_notes || x.show.stalls_move_in_date
        ? ['Full show']
        : [],
    vaccinationNotes: Boolean(x.show.vaccination_notes),
  };
}
