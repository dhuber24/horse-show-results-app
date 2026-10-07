/**
 * What the results filters find — on the public Results page and on the Show
 * Results report, which read them through the same functions so "Back # 14"
 * cannot mean one thing at the rail and another in the office.
 */
import { describe, expect, it } from '@jest/globals';

import {
  NO_FILTERS,
  filterResults,
  matchesWhole,
  matchesWords,
  type FilterablePlacing,
} from './results-filter';
import { describeReportFilters, filterReportRows, type Report } from './reports';

describe('matchesWords', () => {
  it('matches every word in any order, ignoring case', () => {
    expect(matchesWords('smith jane', 'Jane A. Smith')).toBe(true);
    expect(matchesWords('smith john', 'Jane A. Smith')).toBe(false);
  });

  it('matches everything when nothing is typed', () => {
    expect(matchesWords('   ', 'Anything')).toBe(true);
    expect(matchesWords('', null)).toBe(true);
  });

  it('reads a number as a whole number, not a run of digits', () => {
    expect(matchesWords('12', '12', 'Western Pleasure')).toBe(true);
    expect(matchesWords('12', '12A', 'Western Pleasure')).toBe(true);
    expect(matchesWords('12', '112', 'Western Pleasure')).toBe(false);
    expect(matchesWords('12', '120', 'Western Pleasure')).toBe(false);
    expect(matchesWords('12', '5', 'Sat, Jun 12')).toBe(true);
  });

  it('finds a word inside a longer one', () => {
    expect(matchesWords('dust', 'Dusty Gold')).toBe(true);
  });
});

describe('matchesWhole', () => {
  it('matches the whole back number and nothing longer', () => {
    expect(matchesWhole('14', 14)).toBe(true);
    expect(matchesWhole('14', 142)).toBe(false);
    expect(matchesWhole('14', 214)).toBe(false);
  });

  it('ignores a # typed in front', () => {
    expect(matchesWhole('#14', 14)).toBe(true);
    expect(matchesWhole('# 14', '14')).toBe(true);
  });

  it('never matches a missing number, unless nothing is typed', () => {
    expect(matchesWhole('14', null)).toBe(false);
    expect(matchesWhole('', null)).toBe(true);
  });
});

// ── The public Results page ───────────────────────────────────────────────────

type Placing = FilterablePlacing & { place: number | null };

const classes = [
  { id: 'c1', class_number: '1', class_name: 'Western Pleasure', class_date: '2026-06-13' },
  { id: 'c2', class_number: '2', class_name: 'Trail', class_date: '2026-06-13' },
  { id: 'c3', class_number: '3', class_name: 'Ranch Riding', class_date: '2026-06-14' },
];

const index: Record<string, Placing[]> = {
  c1: [
    { entry_id: 'e1', place: 1, back_number: 142, exhibitor_name: 'Ann Reed', horse_name: 'Dusty Gold' },
    { entry_id: 'e2', place: 2, back_number: 14, exhibitor_name: 'Bo Lane', horse_name: 'Red Rocket' },
  ],
  c2: [
    // Reed on another horse, and somebody else on Dusty Gold.
    { entry_id: 'e3', place: 1, back_number: 142, exhibitor_name: 'Ann Reed', horse_name: 'Blue Moon' },
    { entry_id: 'e4', place: 2, back_number: 77, exhibitor_name: 'Cy Ford', horse_name: 'Dusty Gold' },
  ],
  // c3 is not posted yet.
};

describe('filterResults', () => {
  it('lists every class, with nothing under it, when nothing is filtered', () => {
    const { classes: listed, hits } = filterResults(classes, index, NO_FILTERS, null);
    expect(listed.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(hits).toEqual({});
  });

  it('needs every field to match the same placing', () => {
    const { classes: listed, hits } = filterResults(
      classes, index, { ...NO_FILTERS, name: 'reed', horse: 'dusty' }, null,
    );
    // Class 2 has Reed and has Dusty Gold, but not Reed on Dusty Gold.
    expect(listed.map((c) => c.id)).toEqual(['c1']);
    expect(hits.c1.map((p) => p.entry_id)).toEqual(['e1']);
  });

  it('finds back number 14 and not 142', () => {
    const { classes: listed, hits } = filterResults(classes, index, { ...NO_FILTERS, backNumber: '14' }, null);
    expect(listed.map((c) => c.id)).toEqual(['c1']);
    expect(hits.c1.map((p) => p.exhibitor_name)).toEqual(['Bo Lane']);
  });

  it('leaves out a class with no placings once a person is searched for', () => {
    const { classes: listed } = filterResults(classes, index, { ...NO_FILTERS, name: 'reed' }, null);
    expect(listed.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('narrows by class name, number or day', () => {
    expect(filterResults(classes, index, { ...NO_FILTERS, className: 'trail' }, null).classes.map((c) => c.id))
      .toEqual(['c2']);
    expect(filterResults(classes, index, { ...NO_FILTERS, className: '3' }, null).classes.map((c) => c.id))
      .toEqual(['c3']);
    expect(filterResults(classes, index, { ...NO_FILTERS, className: 'jun 14' }, null).classes.map((c) => c.id))
      .toEqual(['c3']);
  });

  describe('My classes', () => {
    const mine = { classIds: new Set(['c2', 'c3']), entryIds: new Set(['e3']) };

    it('lists the classes the reader is in, posted or still to come, with their own placing', () => {
      const { classes: listed, hits } = filterResults(classes, index, NO_FILTERS, mine);
      expect(listed.map((c) => c.id)).toEqual(['c2', 'c3']);
      expect(hits.c2.map((p) => p.entry_id)).toEqual(['e3']);
      expect(hits.c3).toEqual([]);
    });

    it('combines with a search, which then decides what shows under the class', () => {
      const { classes: listed, hits } = filterResults(
        classes, index, { ...NO_FILTERS, horse: 'dusty' }, mine,
      );
      expect(listed.map((c) => c.id)).toEqual(['c2']);
      expect(hits.c2.map((p) => p.entry_id)).toEqual(['e4']);
    });
  });
});

// ── The Show Results report ───────────────────────────────────────────────────

function aReport(rows: Report['rows']): Report {
  return {
    slug: 'results',
    title: 'Show Results',
    description: '',
    show_id: 's',
    show_name: 'Paint-O-Rama',
    generated_at: '2026-06-14T18:00:00Z',
    columns: [],
    rows,
    totals: {},
    notes: [],
    filters: [
      { key: 'my_classes', label: 'My classes', columns: ['class_id'], match: 'my_classes' },
      { key: 'name', label: 'Name', columns: ['exhibitor'], match: 'words' },
      { key: 'back_number', label: 'Back #', columns: ['back_number'], match: 'exact' },
      { key: 'horse', label: 'Horse', columns: ['horse'], match: 'words' },
      { key: 'class', label: 'Class', columns: ['class_number', 'class_name', 'class_code'], match: 'words' },
    ],
  };
}

const report = aReport([
  { class_id: 'c1', class_number: '1', class_name: 'Western Pleasure', class_code: '—', exhibitor: 'Ann Reed', back_number: '142', horse: 'Dusty Gold' },
  { class_id: 'c1', class_number: '1', class_name: 'Western Pleasure', class_code: '—', exhibitor: 'Bo Lane', back_number: '14', horse: 'Red Rocket' },
  { class_id: 'c2', class_number: '2', class_name: 'Trail', class_code: '—', exhibitor: 'Ann Reed', back_number: '142', horse: 'Blue Moon' },
  // No back number: the report prints a dash, which no number matches.
  { class_id: 'c2', class_number: '2', class_name: 'Trail', class_code: '—', exhibitor: 'Cy Ford', back_number: '—', horse: 'Dusty Gold' },
]);

describe('filterReportRows', () => {
  it('keeps every row when nothing is filtered', () => {
    expect(filterReportRows(report, {}, null)).toHaveLength(4);
  });

  it('needs every field to match the same row', () => {
    const rows = filterReportRows(report, { name: 'reed', horse: 'dusty' }, null);
    expect(rows.map((r) => r.class_id)).toEqual(['c1']);
  });

  it('matches the back number whole', () => {
    expect(filterReportRows(report, { back_number: '14' }, null).map((r) => r.exhibitor)).toEqual(['Bo Lane']);
    expect(filterReportRows(report, { back_number: '#142' }, null)).toHaveLength(2);
  });

  it('keeps every row of the reader’s classes with My classes on', () => {
    const rows = filterReportRows(report, {}, new Set(['c2']));
    expect(rows.map((r) => r.exhibitor)).toEqual(['Ann Reed', 'Cy Ford']);
  });

  it('filters nothing on a report that declares no filters', () => {
    const plain = { ...report, filters: undefined };
    expect(filterReportRows(plain, { name: 'nobody' }, new Set())).toHaveLength(4);
  });
});

describe('describeReportFilters', () => {
  it('names what is in use, in the order the report declares it', () => {
    expect(describeReportFilters(report, { horse: 'dusty', name: ' reed ' }, true))
      .toBe('My classes · Name “reed” · Horse “dusty”');
  });

  it('is null when nothing is in use', () => {
    expect(describeReportFilters(report, { name: '  ' }, false)).toBeNull();
  });
});
