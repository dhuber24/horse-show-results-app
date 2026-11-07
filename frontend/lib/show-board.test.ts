// Globals are imported rather than declared ambiently: see `safe-next.test.ts`.
import { describe, expect, it } from '@jest/globals';

import { byline, categoryOf, combineThreads, type BoardThread } from './show-board';

function thread(id: string): BoardThread {
  return {
    id,
    parent_id: null,
    category: 'general',
    body: id,
    created_at: '2026-11-07T15:00:00Z',
    pinned: false,
    hidden: false,
    deleted: false,
    author: { name: 'Visitor', badge: null, back_number: null, anonymous: false, revealed: null },
    is_mine: false,
    replies: [],
  };
}

describe('the byline', () => {
  it('is the name alone without a badge', () => {
    expect(byline({ name: 'Anonymous', badge: null, back_number: null })).toBe('Anonymous');
  });

  it('carries the badge, and an exhibitor’s back number on it', () => {
    expect(byline({ name: 'Jo Office', badge: 'Show Office', back_number: null })).toBe('Jo Office · Show Office');
    expect(byline({ name: 'Pat Rider', badge: 'Exhibitor', back_number: 42 })).toBe('Pat Rider · Exhibitor #42');
  });
});

describe('the categories', () => {
  it('label what the backend sends, and fall back to General', () => {
    expect(categoryOf('lost_found').label).toBe('Lost & Found');
    expect(categoryOf('nonsense' as never).label).toBe('General');
  });
});

describe('combining the poll with older threads', () => {
  it('puts the first page first and never shows a thread twice', () => {
    const combined = combineThreads([thread('a'), thread('b')], [thread('b'), thread('c')]);
    expect(combined.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });
});
