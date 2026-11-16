/**
 * The page between a show bill's read and the show made from it.
 *
 * The person settles the four values a show row needs, who each judge the bill
 * names is, the venue, and the two notes drafted from the read; the backend
 * builds the rest (`tests/test_showbill_draft.py`). Pinned here: where the form
 * starts, what it refuses to send, what it sends, and the directory searches.
 */
import { describe, expect, it } from '@jest/globals';

import {
  draftInputs,
  newJudgeFromBill,
  newVenueFromBill,
  notesFile,
  readSummary,
  searchJudges,
  searchVenues,
  startBody,
  startDefaults,
  startProblems,
  type DirectoryJudge,
  type ShowBillImport,
  type StartForm,
} from './showbill-import';

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
        venue_address: '1 Arena Rd',
        venue_city: 'Hinckley',
        venue_state: 'MN',
        venue_zip: null,
        shavings_ban_outside: true,
        requires_coggins: null,
        requires_health_certificate: null,
        health_certificate_valid_days: null,
        requires_vaccination: null,
      },
      judges: [
        { first_name: 'Jane', last_name: 'Smith', associations: ['APHA'] },
        { first_name: 'Bob', last_name: 'Lee', associations: ['APHA', 'WSCA'] },
      ],
      clubs: [
        { code: 'WSCA', name: null, fee_amount_cents: null, fee_unit: null, fee_text: null },
        { code: 'APHA', name: null, fee_amount_cents: null, fee_unit: null, fee_text: null },
        { code: 'MNSPHC', name: null, fee_amount_cents: null, fee_unit: null, fee_text: null },
      ],
      class_rates: [],
      classes: [
        {
          date: '2027-08-21', number: '1', name: 'Trail', discipline: null, bracket: null,
          association_class_code: null, rate_key: null, club_codes: [], is_championship: false,
          is_futurity: false, futurity: null, side_pots: ['Novice Jackpot'], note: null,
        },
        {
          date: '2027-08-22', number: '2', name: 'Halter', discipline: null, bracket: null,
          association_class_code: null, rate_key: null, club_codes: [], is_championship: false,
          is_futurity: true, futurity: 'Color Futurity', side_pots: [], note: null,
        },
      ],
      fees: [],
      futurities: [{ name: 'Color Futurity' }],
      side_pots: [{ name: 'Novice Jackpot' }],
      warnings: ['Page 4 is cut off.'],
    },
    resolved: {
      show_type_id: 't-apha',
      venue_id: null,
      judges: [
        { suggested_judge_id: 'j-1', candidate_judge_ids: ['j-1'], matched_on: 'name', association_ids: ['a-apha'] },
        { suggested_judge_id: null, candidate_judge_ids: ['j-2'], matched_on: null, association_ids: ['a-apha', 'a-wsca'] },
      ],
      clubs: [
        { association_id: 'a-wsca', is_breed_association: false },
        { association_id: null, is_breed_association: true },
        { association_id: null, is_breed_association: false },
      ],
      classes: [],
    },
    drafted: { public_notes: 'No dogs.', office_notes: 'To check, from the show bill:' },
    ...overrides,
  };
}

function settled(form: StartForm): StartForm {
  return {
    ...form,
    judges: form.judges.map((c) => (c.kind === 'unsettled' ? { kind: 'leave_off' } : c)),
    venue: { kind: 'directory', venue_id: 'v-1' },
  };
}

describe('where the confirm page starts', () => {
  it('starts from what the bill said, with only exact matches settled', () => {
    expect(startDefaults(anImport(), 't-open')).toEqual({
      name: 'Splash of Color',
      show_type_id: 't-apha',
      start_date: '2027-08-21',
      end_date: '2027-08-22',
      attach_showbill: true,
      judges: [{ kind: 'directory', judge_id: 'j-1' }, { kind: 'unsettled' }],
      venue: { kind: 'none' },
      public_notes: 'No dogs.',
      office_notes: 'To check, from the show bill:',
    });
  });

  it('starts an unnamed breed body on Open', () => {
    const imp = anImport();
    imp.resolved!.show_type_id = null;
    expect(startDefaults(imp, 't-open').show_type_id).toBe('t-open');
  });

  it('fills a new judge and a new venue in from the bill', () => {
    expect(newJudgeFromBill(anImport(), 1)).toEqual({
      first_name: 'Bob', last_name: 'Lee', email: '', phone: '', association_ids: ['a-apha', 'a-wsca'],
    });
    expect(newVenueFromBill(anImport())).toEqual({
      name: 'Double F Arena', address: '1 Arena Rd', city: 'Hinckley', state: 'MN', zip: '',
    });
  });
});

describe('what Create refuses', () => {
  it('needs every judge settled and, from a manager, the venue', () => {
    const form = startDefaults(anImport(), null);
    const problems = startProblems(form, anImport(), true);
    expect(problems).toEqual([
      'Find Bob Lee in the judge directory, add them, or leave them off.',
      'Find Double F Arena in the venue directory, or add it.',
    ]);
    expect(startProblems(settled(form), anImport(), true)).toEqual([]);
  });

  it('lets a secretary, who cannot add a venue, leave it blank', () => {
    const form = { ...settled(startDefaults(anImport(), null)), venue: { kind: 'none' as const } };
    expect(startProblems(form, anImport(), false)).toEqual([]);
  });

  it('needs an email or a phone for a new judge, and a full address for a new venue', () => {
    const form: StartForm = {
      ...settled(startDefaults(anImport(), null)),
      judges: [{ kind: 'directory', judge_id: 'j-1' }, { kind: 'new', ...newJudgeFromBill(anImport(), 1) }],
      venue: { kind: 'new', ...newVenueFromBill(anImport()) },
    };
    expect(startProblems(form, anImport(), true)).toEqual([
      'Add an email or a phone for Bob Lee: it is how the directory tells two judges of one name apart.',
      'A new venue needs its name and full address: street, city, state and ZIP.',
    ]);
  });

  it('refuses one judge picked twice, the basics, and notes over their limit', () => {
    const form: StartForm = {
      ...settled(startDefaults(anImport(), null)),
      name: ' ',
      end_date: '2027-08-20',
      judges: [{ kind: 'directory', judge_id: 'j-1' }, { kind: 'directory', judge_id: 'j-1' }],
      public_notes: 'x'.repeat(5001),
    };
    expect(startProblems(form, anImport(), true)).toEqual([
      'The show needs a name.',
      'The end date is before the start date.',
      'The same judge is picked twice.',
      'The show notes are over 5,000 characters.',
    ]);
  });
});

describe('what Create sends', () => {
  it('sends each judge and the venue as the backend takes them, and blank notes as none', () => {
    const form: StartForm = {
      ...startDefaults(anImport(), null),
      judges: [
        { kind: 'directory', judge_id: 'j-1' },
        { kind: 'new', ...newJudgeFromBill(anImport(), 1), phone: ' 555-0100 ' },
      ],
      venue: { kind: 'new', ...newVenueFromBill(anImport()), zip: '55037' },
      public_notes: '  ',
    };
    const body = startBody(form);
    expect(body.judges).toEqual([
      { judge_id: 'j-1' },
      { new: { first_name: 'Bob', last_name: 'Lee', email: null, phone: '555-0100', association_ids: ['a-apha', 'a-wsca'] } },
    ]);
    expect(body.venue).toEqual({
      new: { name: 'Double F Arena', address: '1 Arena Rd', city: 'Hinckley', state: 'MN', zip: '55037' },
    });
    expect(body.public_notes).toBeNull();
    expect(startBody({ ...form, judges: [{ kind: 'leave_off' }], venue: { kind: 'none' } })).toMatchObject({
      judges: [{ leave_off: true }],
      venue: null,
    });
  });

  it('redrafts the notes from the dates, the judges left off and the venue', () => {
    const form = { ...settled(startDefaults(anImport(), null)), start_date: '' };
    expect(draftInputs(form)).toEqual({
      start_date: null, end_date: '2027-08-22', leave_off: [false, true], venue_settled: true,
    });
  });

  it('keeps both notes in one file', () => {
    const text = notesFile(startDefaults(anImport(), null), 'bill.pdf');
    expect(text).toContain('SHOW NOTES (exhibitors see these)\n\nNo dogs.');
    expect(text).toContain('OFFICE NOTES (only the show office)\n\nTo check, from the show bill:');
  });
});

describe('searching the directories', () => {
  const directory: DirectoryJudge[] = [
    { id: 'j-1', first_name: 'Jane', last_name: 'Smith', email: 'jane@example.com', phone: null, associations: [] },
    { id: 'j-2', first_name: 'Robert', last_name: 'Lee', email: null, phone: '555-0100', associations: [] },
    { id: 'j-3', first_name: 'Rob', last_name: 'Leeds', email: null, phone: null, associations: [] },
  ];

  it('offers the bill’s candidates before anything is typed, and every word typed after', () => {
    expect(searchJudges(directory, '', ['j-2']).map((j) => j.id)).toEqual(['j-2']);
    expect(searchJudges(directory, 'rob lee', ['j-2']).map((j) => j.id)).toEqual(['j-2', 'j-3']);
    expect(searchJudges(directory, '555').map((j) => j.id)).toEqual(['j-2']);
  });

  it('finds a venue by its name or its city', () => {
    const venues = [
      { id: 'v-1', name: 'Double F Arena', address: null, city: 'Hinckley', state: 'MN' },
      { id: 'v-2', name: 'County Fairgrounds', address: null, city: 'Duluth', state: 'MN' },
    ];
    expect(searchVenues(venues, 'hinckley').map((v) => v.id)).toEqual(['v-1']);
    expect(searchVenues(venues, '')).toEqual([]);
  });
});

describe('what Create will make', () => {
  it('counts the classes, judges, clubs, futurities and side pots read', () => {
    expect(readSummary(anImport())).toEqual({
      classes: 2,
      days: 2,
      judges: 2,
      // The breed body listed among the clubs is the show type, not a club.
      clubs: 2,
      clubsUnknown: 1,
      fees: 0,
      futurities: 1,
      sidePots: 1,
    });
  });

  it('has nothing to say about a read that has not finished', () => {
    expect(readSummary(anImport({ extracted: null, resolved: null }))).toBeNull();
  });
});
