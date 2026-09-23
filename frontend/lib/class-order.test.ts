/**
 * The one promise the schedule's grouping makes: it never reorders.
 *
 * The running order is settled in the backend (`_renumber_classes` sorts every
 * show by day, then discipline, then division), and the class numbers printed
 * under these headings are published identity. So a grouping that re-sorted
 * would be a display rewriting the programme, which is the failure these cases
 * exist to pin shut.
 */
import { describe, expect, it } from '@jest/globals';

import { runsOf } from './class-order';

describe('grouping a schedule into headings', () => {
  it('describes the order it is given and never reorders it', () => {
    const rows = [
      { id: '1', d: 'Halter' },
      { id: '2', d: 'Halter' },
      { id: '3', d: 'Showmanship' },
    ];
    const runs = runsOf(rows, (r) => r.d);
    expect(runs.map((r) => r.key)).toEqual(['Halter', 'Showmanship']);
    expect(runs.flatMap((r) => r.items.map((i) => i.id))).toEqual(['1', '2', '3']);
  });

  it('gives a discipline that runs twice in a day two headings', () => {
    // A bucket would pull class 3 up under the heading printed at class 1 and
    // silently rewrite the published running order. A real Paint show does run
    // Halter, then Performance Halter, then Halter again for the Grand &
    // Reserve callback — all three headings are true.
    const rows = [
      { id: '1', d: 'Halter' },
      { id: '2', d: 'Performance Halter' },
      { id: '3', d: 'Halter' },
    ];
    const runs = runsOf(rows, (r) => r.d);
    expect(runs.map((r) => r.key)).toEqual(['Halter', 'Performance Halter', 'Halter']);
    expect(runs.flatMap((r) => r.items.map((i) => i.id))).toEqual(['1', '2', '3']);
  });

  it('returns nothing for an empty schedule rather than an empty heading', () => {
    expect(runsOf([], () => 'x')).toEqual([]);
  });
});
