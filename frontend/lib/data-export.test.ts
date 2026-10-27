/**
 * The Data Export page's column choice and its file.
 *
 * The selection is remembered between shows, and the case that matters is a
 * column the office has never been offered: it must arrive with the backend's
 * suggestion rather than silently off.
 */
import { describe, expect, it } from '@jest/globals';

import {
  filledCounts,
  selectionToSave,
  startingSelection,
  toDataCsv,
  type DataExportField,
} from './data-export';

const field = (key: string, isDefault: boolean, label = key): DataExportField => ({
  key,
  label,
  group: 'show',
  kinds: ['placings', 'entries'],
  default: isDefault,
});

describe('startingSelection', () => {
  it('starts from the defaults with nothing remembered', () => {
    const fields = [field('a', true), field('b', false)];
    expect([...startingSelection(fields, null)]).toEqual(['a']);
  });

  it('keeps the office’s own choice for a column it has seen', () => {
    const fields = [field('a', true), field('b', false)];
    const saved = { selected: ['b'], seen: ['a', 'b'] };
    expect([...startingSelection(fields, saved)]).toEqual(['b']);
  });

  it('suggests a column the office has never been offered', () => {
    const fields = [field('a', true), field('member:NSBA', true)];
    const saved = { selected: ['a'], seen: ['a'] };
    expect([...startingSelection(fields, saved)]).toEqual(['a', 'member:NSBA']);
  });
});

describe('selectionToSave', () => {
  it('remembers columns from another show that this one does not offer', () => {
    const saved = { selected: ['member:WSCA'], seen: ['member:WSCA'] };
    const next = selectionToSave([field('a', true)], new Set(['a']), saved);
    expect(next.selected).toEqual(['member:WSCA', 'a']);
    expect(next.seen).toEqual(['member:WSCA', 'a']);
  });

  it('forgets a tick taken off a column this show offers', () => {
    const saved = { selected: ['a'], seen: ['a'] };
    expect(selectionToSave([field('a', true)], new Set(), saved).selected).toEqual([]);
  });
});

describe('filledCounts', () => {
  it('counts the rows with something in each column', () => {
    const counts = filledCounts([field('a', true), field('b', true)], [
      { a: 'x', b: null },
      { a: 0, b: '' },
    ]);
    expect(counts).toEqual({ a: 2, b: 0 });
  });
});

describe('toDataCsv', () => {
  it('starts with the header row and quotes what needs quoting', () => {
    const csv = toDataCsv([field('name', true, 'Exhibitor'), field('place', true, 'Place')], [
      { name: 'Reed, Ann', place: 1 },
      { name: 'Say "Hi"', place: null },
    ]);
    expect(csv.split('\r\n')).toEqual(['Exhibitor,Place', '"Reed, Ann",1', '"Say ""Hi""",']);
  });
});
