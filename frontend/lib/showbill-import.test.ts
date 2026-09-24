/**
 * The review screen for a show read off its show bill.
 *
 * Two things on that screen decide money, and both are pinned here: how many
 * judges a per-judge class price is multiplied by (the same carded-judge rule
 * billing uses, so "$5 per judge" on a WSCA class is $10 at a show with two
 * WSCA judges, not $20), and what each class ends up priced at. The rest is the
 * form's starting state — which matches it takes, and which it declines to.
 */
import { describe, expect, it } from '@jest/globals';

import {
  buildApplyPayload,
  centsFromDollars,
  classCents,
  duplicateClassKeys,
  initialDraft,
  mapClub,
  panelForCount,
  rateCents,
  rateJudgeCount,
  type Association,
  type ShowBillImport,
} from './showbill-import';

const APHA: Association = { id: 'a-apha', code: 'APHA', name: 'American Paint Horse Association', association_type: 'breed' };
const WSCA: Association = { id: 'a-wsca', code: 'WSCA', name: 'Western Saddle Clubs Association', association_type: 'club' };
const ASSOCIATIONS = [APHA, WSCA];

function anImport(overrides: Partial<ShowBillImport> = {}): ShowBillImport {
  return {
    id: 'imp-1',
    status: 'succeeded',
    message: null,
    original_filename: 'bill.pdf',
    created_at: null,
    completed_at: null,
    show_id: null,
    extracted: {
      show: {
        name: 'Splash of Color',
        start_date: '2027-08-21',
        end_date: '2027-08-22',
        entry_deadline: null,
        breed_association: 'APHA',
        apha_show_number: null,
        aqha_show_number: null,
        apha_zone: null,
        venue_name: 'Double F Arena',
        venue_address: null,
        venue_city: 'Hinckley',
        venue_state: 'MN',
        shavings_ban_outside: true,
        requires_coggins: null,
        requires_health_certificate: null,
        health_certificate_valid_days: null,
        requires_vaccination: null,
        staff: [],
      },
      judges: [
        { first_name: 'Josh', last_name: 'Tjosaas', location: null, associations: ['APHA', 'WSCA'] },
        { first_name: 'Nell', last_name: 'Tekampe', location: null, associations: ['APHA'] },
      ],
      clubs: [
        { code: 'WSCA', name: null, fee_amount_cents: null, fee_unit: null, fee_text: null },
        { code: 'APHA', name: null, fee_amount_cents: null, fee_unit: null, fee_text: null },
        { code: 'MNSPHC', name: null, fee_amount_cents: null, fee_unit: null, fee_text: null },
      ],
      class_rates: [
        { key: 'open', label: 'APHA Open', amount_cents: 900, per_judge: true, association_code: null, printed_text: '$9 per judge' },
        { key: 'wsca', label: 'WSCA', amount_cents: 500, per_judge: true, association_code: 'WSCA', printed_text: '$5 per WSCA judge' },
      ],
      classes: [
        { date: '2027-08-21', number: '1', name: 'Amateur Stallions', discipline: 'HALTER', bracket: 'Amateur', association_class_code: 'AMH1', rate_key: 'open', club_codes: [], is_championship: false, is_futurity: false, note: null },
        { date: '2027-08-21', number: '2-3', name: 'Grand & Reserve Amateur Stallions', discipline: 'HALTER', bracket: 'Amateur', association_class_code: null, rate_key: 'open', club_codes: [], is_championship: true, is_futurity: false, note: null },
        { date: '2027-08-21', number: 'A', name: 'Weanling Fillies (Futurity)', discipline: 'HALTER', bracket: 'Futurity', association_class_code: null, rate_key: 'open', club_codes: [], is_championship: false, is_futurity: true, note: null },
        { date: '2027-08-22', number: '90', name: 'WSCA Barrels', discipline: 'Barrel Racing', bracket: 'Open', association_class_code: null, rate_key: 'wsca', club_codes: ['WSCA', 'MNSPHC'], is_championship: false, is_futurity: false, note: null },
      ],
      fees: [],
      not_imported: [],
      warnings: [],
    },
    resolved: {
      show_type_id: 'st-apha',
      venue_id: null,
      judges: [
        { suggested_judge_id: 'j-josh', candidate_judge_ids: ['j-josh'], matched_on: 'name', association_ids: [] },
        { suggested_judge_id: null, candidate_judge_ids: [], matched_on: null, association_ids: ['a-apha'] },
      ],
      clubs: [
        { association_id: 'a-wsca', is_breed_association: false },
        { association_id: null, is_breed_association: true },
        { association_id: null, is_breed_association: false },
      ],
      classes: [
        { discipline: 'Halter', score_type: 'placement', entered_by_qualification: false, club_association_ids: [], unknown_club_codes: [] },
        { discipline: 'Halter', score_type: 'placement', entered_by_qualification: true, club_association_ids: [], unknown_club_codes: [] },
        { discipline: 'Halter', score_type: 'placement', entered_by_qualification: false, club_association_ids: [], unknown_club_codes: [] },
        { discipline: 'Barrel Racing', score_type: 'time', entered_by_qualification: false, club_association_ids: ['a-wsca'], unknown_club_codes: ['MNSPHC'] },
      ],
    },
    ...overrides,
  };
}

const REGISTRY = [
  { id: 'j-josh', first_name: 'Josh', last_name: 'Tjosaas', email: null, associations: [{ id: 'a-apha', code: 'APHA' }, { id: 'a-wsca', code: 'WSCA' }] },
];

const draftFor = (canCreateVenue = true) => initialDraft(anImport(), { canCreateVenue, openShowTypeId: 'st-open' });

describe('the form a read starts as', () => {
  it('starts a name-matched judge on the registry row, and an unmatched one as new', () => {
    const [josh, nell] = draftFor().judges;
    expect(josh).toMatchObject({ mode: 'existing', judge_id: 'j-josh', matched_on: 'name' });
    expect(nell).toMatchObject({ mode: 'new', first_name: 'Nell', association_ids: ['a-apha'] });
  });

  it('leaves out the breed body listed among the clubs, and a club the registry lacks', () => {
    const [wsca, apha, mnsphc] = draftFor().clubs;
    expect(wsca.include).toBe(true);
    expect(apha).toMatchObject({ include: false, is_breed_association: true });
    expect(mnsphc).toMatchObject({ include: false, association_id: '' });
  });

  it('prices neither a championship nor a futurity class, whatever the bill pointed them at', () => {
    const [, championship, futurity] = draftFor().classes;
    expect(championship).toMatchObject({ rate_key: '', entered_by_qualification: true });
    expect(futurity.rate_key).toBe('');
  });

  it('takes the routed discipline over the heading the bill printed', () => {
    expect(draftFor().classes[0].discipline).toBe('Halter');
  });

  it('defaults to requiring a Coggins when the bill says nothing about it', () => {
    expect(draftFor().show.requires_coggins).toBe(true);
  });

  it('does not start a secretary on a new venue they could not create', () => {
    expect(draftFor(true).venue.mode).toBe('new');
    expect(draftFor(false).venue.mode).toBe('none');
  });
});

describe('what a class costs', () => {
  const draft = draftFor();
  const panel = panelForCount(draft.judges, REGISTRY, ASSOCIATIONS);

  it('multiplies a whole-panel per-judge rate by every judge kept', () => {
    const open = draft.rates[0];
    expect(rateJudgeCount(open, panel, ASSOCIATIONS)).toEqual({ count: 2, code: null });
    expect(rateCents(open, 2)).toBe(1800);
  });

  it("multiplies an association's per-judge rate by that association's judges only", () => {
    // Josh is carded WSCA on the registry; Nell is being created APHA-only.
    expect(rateJudgeCount(draft.rates[1], panel, ASSOCIATIONS)).toEqual({ count: 1, code: 'WSCA' });
  });

  it('falls back to the whole panel when nobody is carded with the association', () => {
    const noWsca = panelForCount(draft.judges.slice(1), REGISTRY, ASSOCIATIONS);
    expect(rateJudgeCount(draft.rates[1], noWsca, ASSOCIATIONS).count).toBe(1);
  });

  it('counts only the judges still ticked', () => {
    const judges = draft.judges.map((j, i) => (i === 1 ? { ...j, include: false } : j));
    expect(panelForCount(judges, REGISTRY, ASSOCIATIONS)).toHaveLength(1);
  });

  it('prices a class by its override, else its rate, else nothing', () => {
    const totals = new Map<string, number | null>([['open', 1800]]);
    const cls = draft.classes[0];
    expect(classCents(cls, totals)).toBe(1800);
    expect(classCents({ ...cls, fee_override: '12.50' }, totals)).toBe(1250);
    expect(classCents({ ...cls, rate_key: '' }, totals)).toBe(0);
    expect(classCents({ ...cls, fee_override: 'twelve' }, totals)).toBeNull();
  });

  it('reads a typed price the way the fee editors do', () => {
    expect(centsFromDollars('')).toBe(0);
    expect(centsFromDollars('$36')).toBe(3600);
    expect(centsFromDollars('7.5')).toBe(750);
    expect(centsFromDollars('7.555')).toBeNull();
  });
});

describe('answering the questions the read could not', () => {
  it('designates the classes the bill marked for a club once that club is found in the registry', () => {
    const draft = draftFor();
    const mnsphcKey = draft.clubs[2].key;
    const mapped = mapClub(draft, mnsphcKey, 'a-mnsphc');
    const barrels = mapped.classes[3];
    expect(mapped.clubs[2]).toMatchObject({ association_id: 'a-mnsphc', include: true });
    expect(barrels.club_association_ids).toEqual(['a-wsca', 'a-mnsphc']);
    expect(barrels.unknown_club_codes).toEqual([]);
  });

  it('flags a second class of the same name on the same day, but not on another day', () => {
    const draft = draftFor();
    const classes = [
      draft.classes[0],
      { ...draft.classes[0], key: 'dup', class_name: 'amateur  stallions' },
      { ...draft.classes[0], key: 'sunday', class_date: '2027-08-22' },
    ];
    expect([...duplicateClassKeys(classes)]).toEqual(['dup']);
  });
});

describe('the payload', () => {
  const totals = new Map<string, number | null>([['open', 1800], ['wsca', 500]]);

  it('carries prices in cents and drops designations for a club taken off sanctioning', () => {
    const draft = draftFor();
    draft.clubs[0] = { ...draft.clubs[0], include: false };
    const built = buildApplyPayload(draft, totals);
    expect(built.errors).toEqual([]);
    const classes = built.payload!.classes as { entry_fee_cents: number; club_association_ids: string[] }[];
    expect(classes[0].entry_fee_cents).toBe(1800);
    expect(classes[3]).toMatchObject({ entry_fee_cents: 500, club_association_ids: [] });
    expect(built.payload!.clubs).toEqual([]);
  });

  it('sends a registry judge by id and a new judge with their cards', () => {
    const built = buildApplyPayload(draftFor(), totals);
    expect(built.payload!.judges).toEqual([
      { judge_id: 'j-josh' },
      { first_name: 'Nell', last_name: 'Tekampe', email: null, association_ids: ['a-apha'] },
    ]);
  });

  it('refuses a form with every problem it can see at once', () => {
    const draft = draftFor();
    draft.show = { ...draft.show, name: ' ', apha_zone: '22' };
    draft.venue = { ...draft.venue, mode: 'new', name: '' };
    const built = buildApplyPayload(draft, totals);
    expect(built.payload).toBeNull();
    expect(built.errors).toHaveLength(3);
  });
});
