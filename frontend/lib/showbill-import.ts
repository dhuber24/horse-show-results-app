/**
 * The review screen for a show read off its own show bill — its state, and
 * the payload it sends.
 *
 * The backend reads the bill (`extraction/showbill.py`) and matches what it
 * read against the app (`showbill_import.prepare_draft`). This module turns
 * that into a form, and the form back into `POST /show-bill-imports/{id}/apply`.
 * Kept apart from the component so the two pieces of arithmetic that decide
 * money — how many judges a per-judge class rate is multiplied by, and what a
 * class ends up priced at — are testable without rendering anything.
 *
 * Every value that reaches the show passes through a box on this screen. That
 * is the whole design: the model suggests, a person saves.
 */

import { cardedJudgeCount, type ClubSanctionUnit, type FeeUnit } from '@/lib/fee-units';

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
  not_imported: string[];
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

/** The lookups the review screen matches against. */
export type Association = { id: string; code: string; name: string; association_type: 'breed' | 'club' };
export type RegistryJudge = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  associations: { id: string; code: string }[];
};

// ── The form ────────────────────────────────────────────────────────────────

export type DraftShow = {
  name: string;
  show_type_id: string;
  start_date: string;
  end_date: string;
  entry_deadline: string;
  apha_show_number: string;
  aqha_show_number: string;
  apha_zone: string;
  shavings_ban_outside: boolean;
  requires_coggins: boolean;
  requires_health_certificate: boolean;
  health_certificate_valid_days: string;
  requires_vaccination: boolean;
};

export type DraftVenue = {
  mode: 'existing' | 'new' | 'none';
  venue_id: string;
  name: string;
  address: string;
  city: string;
  state: string;
};

export type DraftJudge = {
  key: string;
  include: boolean;
  printed: string;
  mode: 'existing' | 'new';
  judge_id: string;
  candidate_ids: string[];
  matched_on: string | null;
  first_name: string;
  last_name: string;
  email: string;
  association_ids: string[];
};

export type DraftClub = {
  key: string;
  include: boolean;
  /** The club's code as the bill prints it — what classes' `unknown_club_codes` name. */
  code: string;
  printed: string;
  association_id: string;
  is_breed_association: boolean;
  fee_amount: string;
  fee_unit: ClubSanctionUnit;
};

export type DraftRate = {
  key: string;
  label: string;
  printed_text: string | null;
  amount: string;
  per_judge: boolean;
  association_code: string | null;
};

export type DraftClass = {
  key: string;
  include: boolean;
  number: string | null;
  class_date: string;
  class_name: string;
  discipline: string;
  bracket: string;
  association_class_code: string;
  /** Which rate prices the class; '' for a class priced by hand or at $0. */
  rate_key: string;
  /** A price typed over the rate, in dollars; null while the rate decides. */
  fee_override: string | null;
  club_association_ids: string[];
  unknown_club_codes: string[];
  entered_by_qualification: boolean;
  is_futurity: boolean;
  note: string | null;
};

export type DraftFee = {
  key: string;
  include: boolean;
  label: string;
  amount: string;
  unit: FeeUnit;
  notes: string;
  early_amount: string;
  early_deadline: string;
  min_quantity: string;
};

export type Draft = {
  show: DraftShow;
  venue: DraftVenue;
  judges: DraftJudge[];
  clubs: DraftClub[];
  rates: DraftRate[];
  classes: DraftClass[];
  fees: DraftFee[];
  attach_showbill: boolean;
};

// ── Money ───────────────────────────────────────────────────────────────────

export function dollarsFromCents(cents: number | null | undefined): string {
  return cents == null ? '' : (cents / 100).toFixed(2);
}

/** Same rule as the fee editors: blank is $0, anything else must be a price. */
export function centsFromDollars(input: string): number | null {
  const trimmed = input.trim().replace(/^\$/, '');
  if (trimmed === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(parseFloat(trimmed) * 100);
}

// ── Building the form from a read ───────────────────────────────────────────

/**
 * The form's first state: what the bill said, with every match the backend
 * found already applied, and every one of them editable.
 *
 * Two starting choices deserve saying out loud. A **judge** the backend matched
 * by name starts on that registry row, because a second row for somebody
 * already in the registry — with no email to tell them apart — is the worse
 * mistake; one it could not match starts as a new judge. A **venue** the
 * caller may not create (a secretary, who cannot `POST /venues`) starts on
 * "none" rather than on a form their press would be refused over.
 */
export function initialDraft(
  imp: ShowBillImport,
  opts: { canCreateVenue: boolean; openShowTypeId: string | null },
): Draft {
  const x = imp.extracted!;
  const r = imp.resolved!;
  const s = x.show;

  const show: DraftShow = {
    name: s.name ?? '',
    show_type_id: r.show_type_id ?? opts.openShowTypeId ?? '',
    start_date: s.start_date ?? '',
    end_date: s.end_date ?? '',
    entry_deadline: s.entry_deadline ?? '',
    apha_show_number: s.apha_show_number ?? '',
    aqha_show_number: s.aqha_show_number ?? '',
    apha_zone: s.apha_zone != null ? String(s.apha_zone) : '',
    shavings_ban_outside: s.shavings_ban_outside ?? false,
    // Every show requires a Coggins unless it says otherwise — the column's own
    // default. A bill that says nothing about it is not saying "no".
    requires_coggins: s.requires_coggins ?? true,
    requires_health_certificate: s.requires_health_certificate ?? false,
    health_certificate_valid_days: String(s.health_certificate_valid_days ?? 30),
    requires_vaccination: s.requires_vaccination ?? false,
  };

  const venue: DraftVenue = {
    mode: r.venue_id ? 'existing' : s.venue_name && opts.canCreateVenue ? 'new' : 'none',
    venue_id: r.venue_id ?? '',
    name: s.venue_name ?? '',
    address: s.venue_address ?? '',
    city: s.venue_city ?? '',
    state: s.venue_state ?? '',
  };

  const judges: DraftJudge[] = x.judges.map((j, i) => {
    const match = r.judges[i];
    return {
      key: `j${i}`,
      include: true,
      printed: [`${j.first_name} ${j.last_name}`, j.location, j.associations.join('/')]
        .filter(Boolean)
        .join(' · '),
      mode: match?.suggested_judge_id ? 'existing' : 'new',
      judge_id: match?.suggested_judge_id ?? match?.candidate_judge_ids[0] ?? '',
      candidate_ids: match?.candidate_judge_ids ?? [],
      matched_on: match?.matched_on ?? null,
      first_name: j.first_name,
      last_name: j.last_name,
      email: '',
      association_ids: match?.association_ids ?? [],
    };
  });

  const clubs: DraftClub[] = x.clubs.map((c, i) => {
    const match = r.clubs[i];
    return {
      key: `c${i}`,
      // A breed body listed among the clubs is the show type named twice; it
      // is shown so nobody wonders where it went, and left out.
      include: Boolean(match?.association_id) && !match?.is_breed_association,
      code: c.code,
      printed: [c.code, c.name, c.fee_text].filter(Boolean).join(' · '),
      association_id: match?.association_id ?? '',
      is_breed_association: match?.is_breed_association ?? false,
      fee_amount: c.fee_amount_cents ? dollarsFromCents(c.fee_amount_cents) : '0.00',
      fee_unit: c.fee_unit ?? 'per_entry',
    };
  });

  const rates: DraftRate[] = x.class_rates.map((rate) => ({
    key: rate.key,
    label: rate.label,
    printed_text: rate.printed_text,
    amount: dollarsFromCents(rate.amount_cents),
    per_judge: rate.per_judge,
    association_code: rate.association_code,
  }));

  const classes: DraftClass[] = x.classes.map((c, i) => {
    const routed = r.classes[i];
    return {
      key: `k${i}`,
      include: true,
      number: c.number,
      class_date: c.date ?? s.start_date ?? '',
      class_name: c.name,
      discipline: routed?.discipline ?? c.discipline ?? '',
      bracket: c.bracket ?? '',
      association_class_code: c.association_class_code ?? '',
      // A futurity prices its own classes by the entrant's category and a
      // championship is placed into, not entered — both carry $0 on the class.
      rate_key: c.is_futurity || c.is_championship ? '' : c.rate_key ?? '',
      fee_override: null,
      club_association_ids: routed?.club_association_ids ?? [],
      unknown_club_codes: routed?.unknown_club_codes ?? [],
      entered_by_qualification: routed?.entered_by_qualification ?? c.is_championship,
      is_futurity: c.is_futurity,
      note: c.note,
    };
  });

  const fees: DraftFee[] = x.fees.map((f, i) => ({
    key: `f${i}`,
    include: true,
    label: f.label,
    amount: dollarsFromCents(f.amount_cents),
    unit: f.unit,
    notes: f.notes ?? '',
    early_amount: f.early_amount_cents != null ? dollarsFromCents(f.early_amount_cents) : '',
    early_deadline: f.early_deadline ?? '',
    min_quantity: f.min_quantity ? String(f.min_quantity) : '',
  }));

  return { show, venue, judges, clubs, rates, classes, fees, attach_showbill: true };
}

// ── What a class costs ──────────────────────────────────────────────────────

/**
 * The panel as `cardedJudgeCount` wants it: every judge still on the panel,
 * with the cards the app will hold for them — a registry judge's own cards,
 * or the ones a new judge is about to be created with.
 */
export function panelForCount(
  judges: DraftJudge[],
  registry: RegistryJudge[],
  associations: Association[],
): { associations: { id: string; code: string }[] }[] {
  const byId = new Map(registry.map((j) => [j.id, j]));
  const assocById = new Map(associations.map((a) => [a.id, a]));
  return judges
    .filter((j) => j.include)
    .map((j) => {
      if (j.mode === 'existing') return { associations: byId.get(j.judge_id)?.associations ?? [] };
      return {
        associations: j.association_ids
          .map((id) => assocById.get(id))
          .filter((a): a is Association => !!a)
          .map((a) => ({ id: a.id, code: a.code })),
      };
    });
}

/**
 * How many judges a per-judge class rate is multiplied by.
 *
 * The same rule billing uses for a per-judge fee (`billing.carded_judge_count`,
 * mirrored as `cardedJudgeCount`): the judges carded with the rate's
 * association, or the whole panel when nobody is — or when the rate names no
 * association at all. "$5 per judge" on a WSCA class at a show with two
 * WSCA-carded judges out of four is $10, not $20.
 */
export function rateJudgeCount(
  rate: DraftRate,
  panel: { associations: { id: string; code: string }[] }[],
  associations: Association[],
): { count: number; code: string | null } {
  if (!rate.association_code) return { count: panel.length, code: null };
  // The bill's spelling of the code is matched case-blind to the registry's,
  // which is what the panel's cards carry ("APHC" on a bill is ApHC here).
  const assoc = associations.find(
    (a) => a.code.toUpperCase() === rate.association_code!.toUpperCase(),
  );
  if (!assoc) return { count: panel.length, code: null };
  return cardedJudgeCount(panel, { id: assoc.id, code: assoc.code });
}

/** A rate's price for one class, or null when the typed amount is not a price. */
export function rateCents(rate: DraftRate, judgeCount: number): number | null {
  const cents = centsFromDollars(rate.amount);
  if (cents == null) return null;
  return rate.per_judge ? cents * judgeCount : cents;
}

/** What one class will be priced at: a typed override, else its rate, else $0. */
export function classCents(
  cls: DraftClass,
  rateTotals: Map<string, number | null>,
): number | null {
  if (cls.fee_override != null) return centsFromDollars(cls.fee_override);
  if (!cls.rate_key) return 0;
  return rateTotals.get(cls.rate_key) ?? 0;
}

/**
 * Point a club the backend could not match at a registry club, and designate
 * the classes the bill marked for it.
 *
 * The bill said which classes were "WSCA"; the only thing missing was which
 * registry row "WSCA" is. Once the reviewer answers that, making them tick the
 * same forty classes by hand would be asking the question twice.
 */
export function mapClub(draft: Draft, clubKey: string, associationId: string): Draft {
  const club = draft.clubs.find((c) => c.key === clubKey);
  if (!club) return draft;
  const code = club.code.toUpperCase();
  return {
    ...draft,
    clubs: draft.clubs.map((c) =>
      c.key === clubKey ? { ...c, association_id: associationId, include: Boolean(associationId) } : c,
    ),
    classes: draft.classes.map((cls) => {
      if (!associationId || !cls.unknown_club_codes.some((u) => u.toUpperCase() === code)) return cls;
      return {
        ...cls,
        unknown_club_codes: cls.unknown_club_codes.filter((u) => u.toUpperCase() !== code),
        club_association_ids: cls.club_association_ids.includes(associationId)
          ? cls.club_association_ids
          : [...cls.club_association_ids, associationId],
      };
    }),
  };
}

// ── Checks the screen can make before sending ───────────────────────────────

/** Same-day duplicate names, the Class Builder's rule. Keys of every row after the first. */
export function duplicateClassKeys(classes: DraftClass[]): Set<string> {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const c of classes) {
    if (!c.include) continue;
    const id = `${c.class_date}|${c.class_name.trim().toLowerCase().replace(/\s+/g, ' ')}`;
    if (seen.has(id)) dupes.add(c.key);
    else seen.add(id);
  }
  return dupes;
}

// ── The payload ─────────────────────────────────────────────────────────────

export type ApplyPayload = {
  show: Record<string, unknown>;
  venue: Record<string, unknown> | null;
  judges: Record<string, unknown>[];
  clubs: Record<string, unknown>[];
  classes: Record<string, unknown>[];
  fees: Record<string, unknown>[];
  attach_showbill: boolean;
};

/**
 * The reviewed form as `ShowBillImportApply`, or every reason it cannot be one.
 *
 * Only the checks that need nothing but the form: a price that is not a price,
 * a required box left blank. Everything that needs the database — a judge
 * already in the registry, a club no longer active — is the backend's, which
 * answers with the whole list at once.
 */
export function buildApplyPayload(
  draft: Draft,
  rateTotals: Map<string, number | null>,
): { payload: ApplyPayload; errors: [] } | { payload: null; errors: string[] } {
  const errors: string[] = [];
  const s = draft.show;
  if (!s.name.trim()) errors.push('The show needs a name.');
  if (!s.show_type_id) errors.push('Pick the breed association the show runs under (or Open).');
  if (!s.start_date || !s.end_date) errors.push('The show needs a start and an end date.');
  else if (s.end_date < s.start_date) errors.push('The end date is before the start date.');

  const zone = s.apha_zone.trim() ? Number(s.apha_zone) : null;
  if (zone != null && !(Number.isInteger(zone) && zone >= 1 && zone <= 14)) {
    errors.push('An APHA zone is a number from 1 to 14.');
  }
  const cviDays = Number(s.health_certificate_valid_days || 30);
  if (!(Number.isInteger(cviDays) && cviDays >= 1 && cviDays <= 365)) {
    errors.push('How recent a health certificate must be is a number of days, 1 to 365.');
  }

  let venue: Record<string, unknown> | null = null;
  if (draft.venue.mode === 'existing') {
    if (!draft.venue.venue_id) errors.push('Pick the venue, or choose no venue.');
    venue = { venue_id: draft.venue.venue_id };
  } else if (draft.venue.mode === 'new') {
    if (!draft.venue.name.trim()) errors.push('A new venue needs a name.');
    venue = {
      name: draft.venue.name.trim(),
      address: draft.venue.address.trim() || null,
      city: draft.venue.city.trim() || null,
      state: draft.venue.state.trim() || null,
    };
  }

  const judges = draft.judges
    .filter((j) => j.include)
    .map((j) => {
      if (j.mode === 'existing') {
        if (!j.judge_id) errors.push(`Pick the registry judge for ${j.printed}, or add them as new.`);
        return { judge_id: j.judge_id };
      }
      if (!j.first_name.trim() || !j.last_name.trim()) {
        errors.push(`A new judge needs a first and last name (${j.printed}).`);
      }
      return {
        first_name: j.first_name.trim(),
        last_name: j.last_name.trim(),
        email: j.email.trim() || null,
        association_ids: j.association_ids,
      };
    });

  const clubs = draft.clubs
    .filter((c) => c.include)
    .map((c) => {
      if (!c.association_id) errors.push(`${c.printed} is not a club in the registry — untick it.`);
      const cents = centsFromDollars(c.fee_amount);
      if (cents == null) errors.push(`${c.printed}: the club fee is not a price.`);
      return { association_id: c.association_id, fee_amount_cents: cents ?? 0, fee_unit: c.fee_unit };
    });
  const clubIds = new Set(clubs.map((c) => c.association_id));

  const badPrices: string[] = [];
  const classes = draft.classes
    .filter((c) => c.include)
    .map((c) => {
      const cents = classCents(c, rateTotals);
      if (cents == null) badPrices.push(c.class_name);
      if (!c.class_date) errors.push(`${c.class_name} has no day.`);
      return {
        class_date: c.class_date,
        class_name: c.class_name.trim(),
        discipline: c.discipline.trim() || null,
        bracket: c.bracket.trim() || null,
        association_class_code: c.association_class_code.trim() || null,
        entry_fee_cents: cents ?? 0,
        // A club dropped from sanctioning above takes its designations with
        // it, rather than failing the whole press over rows nobody can see.
        club_association_ids: c.club_association_ids.filter((id) => clubIds.has(id)),
        entered_by_qualification: c.entered_by_qualification,
      };
    });
  if (badPrices.length) {
    errors.push(
      `These classes have a price that is not a price: ${badPrices.slice(0, 5).join(', ')}` +
        (badPrices.length > 5 ? ` and ${badPrices.length - 5} more.` : '.'),
    );
  }

  const fees = draft.fees
    .filter((f) => f.include)
    .map((f) => {
      const cents = centsFromDollars(f.amount);
      if (cents == null) errors.push(`${f.label}: the amount is not a price.`);
      const early = f.early_amount.trim() ? centsFromDollars(f.early_amount) : null;
      if (f.early_amount.trim() && early == null) errors.push(`${f.label}: the early rate is not a price.`);
      const minimum = f.min_quantity.trim() ? Number(f.min_quantity) : 0;
      if (!(Number.isInteger(minimum) && minimum >= 0 && minimum <= 999)) {
        errors.push(`${f.label}: the minimum is a whole number of bags.`);
      }
      return {
        label: f.label.trim(),
        amount_cents: cents ?? 0,
        unit: f.unit,
        notes: f.notes.trim() || null,
        early_amount_cents: early,
        early_deadline: f.early_deadline || null,
        min_quantity: Number.isInteger(minimum) ? minimum : 0,
      };
    });

  if (errors.length) return { payload: null, errors };
  return {
    payload: {
      show: {
        name: s.name.trim(),
        show_type_id: s.show_type_id,
        start_date: s.start_date,
        end_date: s.end_date,
        entry_deadline: s.entry_deadline || null,
        apha_show_number: s.apha_show_number.trim() || null,
        aqha_show_number: s.aqha_show_number.trim() || null,
        apha_zone: zone,
        shavings_ban_outside: s.shavings_ban_outside,
        requires_coggins: s.requires_coggins,
        requires_health_certificate: s.requires_health_certificate,
        health_certificate_valid_days: cviDays,
        requires_vaccination: s.requires_vaccination,
      },
      venue,
      judges,
      clubs,
      classes,
      fees,
      attach_showbill: draft.attach_showbill,
    },
    errors: [],
  };
}
