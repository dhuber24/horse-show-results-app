/**
 * The page between a show bill's read and the show made from it (migration 187).
 *
 * The person confirms the four values a show row needs and presses Create; the
 * rest of the read becomes the show and its checks, which the backend builds
 * (`tests/test_showbill_checks.py`). Pinned here: where the form starts, what
 * it refuses to send, and what the summary promises Create will make.
 */
import { describe, expect, it } from '@jest/globals';

import {
  readSummary,
  readerDoubts,
  startDefaults,
  startProblems,
  type ShowBillImport,
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
        { first_name: 'Jane', last_name: 'Smith', location: null, associations: ['APHA'], check: null },
        { first_name: 'Bob', last_name: 'Lee', location: null, associations: [], check: 'Surname smudged.' },
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
          is_futurity: false, note: 'Price smudged.',
        },
        {
          date: '2027-08-22', number: '2', name: 'Halter', discipline: null, bracket: null,
          association_class_code: null, rate_key: null, club_codes: [], is_championship: false,
          is_futurity: false, note: null,
        },
      ],
      fees: [],
      show_checks: [{ field: 'start_date', message: 'Year inferred.' }],
      not_imported: [],
      warnings: ['Page 4 is cut off.'],
    },
    resolved: {
      show_type_id: 't-apha',
      venue_id: null,
      judges: [
        { suggested_judge_id: 'j-1', candidate_judge_ids: ['j-1'], matched_on: 'name', association_ids: [] },
        { suggested_judge_id: null, candidate_judge_ids: [], matched_on: null, association_ids: [] },
      ],
      clubs: [
        { association_id: 'a-wsca', is_breed_association: false },
        { association_id: null, is_breed_association: true },
        { association_id: null, is_breed_association: false },
      ],
      classes: [],
    },
    ...overrides,
  };
}

describe('the four values a show needs', () => {
  it('starts from what the bill said, with the breed body matched', () => {
    expect(startDefaults(anImport(), 't-open')).toEqual({
      name: 'Splash of Color',
      show_type_id: 't-apha',
      start_date: '2027-08-21',
      end_date: '2027-08-22',
      attach_showbill: true,
    });
  });

  it('starts an unnamed breed body on Open', () => {
    const imp = anImport();
    imp.resolved!.show_type_id = null;
    expect(startDefaults(imp, 't-open').show_type_id).toBe('t-open');
  });

  it('refuses every missing value at once, and a reversed range', () => {
    expect(startProblems({ name: ' ', show_type_id: '', start_date: '', end_date: '', attach_showbill: true })).toHaveLength(3);
    expect(
      startProblems({ name: 'X', show_type_id: 't', start_date: '2027-08-22', end_date: '2027-08-21', attach_showbill: true }),
    ).toEqual(['The end date is before the start date.']);
  });

  it("shows the reader's doubt beside the box it is about", () => {
    expect(readerDoubts(anImport(), 'start_date')).toEqual(['Year inferred.']);
    expect(readerDoubts(anImport(), 'name')).toEqual([]);
  });
});

describe('what Create will make', () => {
  it('counts what is attached and what is left for the steps', () => {
    expect(readSummary(anImport())).toEqual({
      classes: 2,
      days: 2,
      judges: 2,
      judgesMatched: 1,
      // The breed body listed among the clubs is the show type, not a club.
      clubs: 2,
      clubsUnknown: 1,
      fees: 0,
      venueMatched: false,
      venueNamed: true,
      // The whole-bill warning, the start date, the class note, Bob's surname.
      readerDoubts: 4,
    });
  });

  it('has nothing to say about a read that has not finished', () => {
    expect(readSummary(anImport({ extracted: null, resolved: null }))).toBeNull();
  });
});
