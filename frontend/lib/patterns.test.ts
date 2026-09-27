/**
 * The rules every screen printing a pattern has to agree on.
 *
 * `nameFromFilename` mirrors `name_from_filename` in `routers/show_patterns.py`
 * case for case — the form's suggestion and the backend's fallback must not
 * name the same file two different things.
 */
import { describe, expect, it } from '@jest/globals';

import {
  applyAssignment,
  nameFromFilename,
  patternFileHref,
  patternsForClasses,
  wasReplaced,
  type ShowPattern,
} from './patterns';

function pattern(id: string, classIds: string[], overrides: Partial<ShowPattern> = {}): ShowPattern {
  return {
    id,
    show_id: 'show-1',
    name: `Pattern ${id}`,
    notes: null,
    original_filename: `${id}.pdf`,
    mime_type: 'application/pdf',
    file_size: 1000,
    created_at: '2026-09-24T15:00:00Z',
    file_uploaded_at: '2026-09-24T15:00:00Z',
    classes: classIds.map((cid) => ({
      id: cid,
      class_number: cid,
      class_name: `Class ${cid}`,
      class_date: '2026-10-03',
    })),
    ...overrides,
  };
}

describe('the name suggested from a file', () => {
  it.each([
    ['Showmanship_Pattern-2.pdf', 'Showmanship Pattern 2'],
    ['trail.jpg', 'trail'],
    ['Western Riding.v2.pdf', 'Western Riding.v2'],
    ['C:\\fakepath\\Ranch Riding 4.png', 'Ranch Riding 4'],
    ['no-extension', 'no extension'],
    ['.pdf', ''],
    ['___.pdf', ''],
  ])('%s -> %s', (filename, expected) => {
    expect(nameFromFilename(filename)).toBe(expected);
  });
});

describe('whether the judge changed a pattern', () => {
  it('is not a change when the file is the one first put on file', () => {
    expect(wasReplaced(pattern('a', []))).toBe(false);
  });

  it('is a change once the file went up after the pattern did', () => {
    expect(
      wasReplaced(pattern('a', [], { file_uploaded_at: '2026-09-26T19:14:00Z' })),
    ).toBe(true);
  });

  it('counts a file replaced within the minute — a wrong file swapped straight away', () => {
    expect(
      wasReplaced(pattern('a', [], { file_uploaded_at: '2026-09-24T15:00:46Z' })),
    ).toBe(true);
  });

  it('allows for a timestamp rounded on the way to the reader', () => {
    expect(
      wasReplaced(pattern('a', [], { file_uploaded_at: '2026-09-24T15:00:00.400Z' })),
    ).toBe(false);
  });
});

describe('the patterns for my classes', () => {
  it('keeps only the patterns running a class I entered, narrowed to those classes', () => {
    const list = [pattern('show', ['12', '14', '27']), pattern('trail', ['31']), pattern('wr', ['40'])];
    const mine = patternsForClasses(list, ['14', '40']);
    expect(mine.map((p) => p.id)).toEqual(['show', 'wr']);
    expect(mine[0].classes.map((c) => c.id)).toEqual(['14']);
  });

  it('is nothing for somebody entered in nothing', () => {
    expect(patternsForClasses([pattern('show', ['12'])], [])).toEqual([]);
  });

  it('leaves the list it was given alone', () => {
    const list = [pattern('show', ['12', '14'])];
    patternsForClasses(list, ['14']);
    expect(list[0].classes).toHaveLength(2);
  });
});

describe('pointing classes at a pattern on the office class list', () => {
  const schedule = ['10', '12', '14', '27', '31'].map((id) => ({
    id,
    class_number: id,
    class_name: `Class ${id}`,
    class_date: '2026-10-03',
  }));

  it('moves a class off the pattern it ran, since a class runs one', () => {
    const next = applyAssignment(
      [pattern('show', ['12', '14']), pattern('trail', ['31'])],
      schedule,
      ['14'],
      'trail',
    );
    expect(next[0].classes.map((c) => c.id)).toEqual(['12']);
    expect(next[1].classes.map((c) => c.id)).toEqual(['14', '31']);
  });

  it('keeps a pattern’s classes in running order, however they were added', () => {
    const next = applyAssignment([pattern('show', ['27'])], schedule, ['10', '14'], 'show');
    expect(next[0].classes.map((c) => c.id)).toEqual(['10', '14', '27']);
  });

  it('takes a class off every pattern when pointed at none', () => {
    const next = applyAssignment([pattern('show', ['12', '14'])], schedule, ['12'], null);
    expect(next[0].classes.map((c) => c.id)).toEqual(['14']);
  });

  it('hands back the same object for a pattern nothing touched', () => {
    const untouched = pattern('trail', ['31']);
    const next = applyAssignment([pattern('show', ['12']), untouched], schedule, ['12'], null);
    expect(next[1]).toBe(untouched);
  });
});

describe('the link to a pattern', () => {
  it('goes through the Next handler, with a version that changes on replacement', () => {
    const first = patternFileHref('s1', 'p1', { version: '2026-09-24T15:00:00Z' });
    const second = patternFileHref('s1', 'p1', { version: '2026-09-26T19:14:00Z' });
    expect(first.startsWith('/api/shows/s1/patterns/p1/file?v=')).toBe(true);
    expect(first).not.toBe(second);
  });

  it('asks for a download only when told to', () => {
    expect(patternFileHref('s1', 'p1')).toBe('/api/shows/s1/patterns/p1/file');
    expect(patternFileHref('s1', 'p1', { download: true })).toBe(
      '/api/shows/s1/patterns/p1/file?download=1',
    );
  });
});
