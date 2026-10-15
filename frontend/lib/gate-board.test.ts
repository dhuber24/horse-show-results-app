/**
 * The gate board's view of a ring: what is in the ring, on deck, in the hole
 * and coming up, and which day it shows — read off the gate steward's buttons
 * alone, never off posted results.
 */
import { describe, expect, it } from '@jest/globals';

import {
  NO_RING,
  boardDay,
  boardRings,
  gateLane,
  numbersOrderOfGo,
  riderTally,
  type BoardClass,
  type BoardRider,
} from './gate-board';

const DAY = '2026-10-10';
const POSTED = '2026-10-10T15:00:00Z';

/** A class as the gate's list serves it, which carries the posting time too —
 *  so these cases can show the board ignoring it. */
type Row = BoardClass & { results_published_at?: string | null };

function cls(id: string, over: Partial<Row> = {}): Row {
  return {
    id,
    class_number: id,
    class_name: `Class ${id}`,
    class_date: DAY,
    status: 'OPEN',
    ring_id: 'r1',
    ring_name: 'Main Arena',
    ring_sort_order: 1,
    gate_status: 'pending',
    results_published_at: null,
    entry_count: 8,
    ...over,
  };
}

function rider(id: string, over: Partial<BoardRider> = {}): BoardRider {
  return {
    id,
    back_number: Number(id),
    exhibitor_name: `Rider ${id}`,
    horse_name: `Horse ${id}`,
    gate_order: null,
    gate_checked_in: false,
    gate_no_show: false,
    ...over,
  };
}

const ids = (list: BoardClass[]) => list.map((c) => c.id);

describe('the lane', () => {
  it('calls the first two classes before anything has gone in', () => {
    const lane = gateLane([cls('1'), cls('2'), cls('3'), cls('4')], 'r1', DAY)!;
    expect(lane.inRing).toEqual([]);
    expect(lane.underway).toBe(false);
    expect(lane.onDeck?.id).toBe('1');
    expect(lane.inTheHole?.id).toBe('2');
    expect(ids(lane.comingUp)).toEqual(['3', '4']);
  });

  it('puts the class after the one in the ring on deck', () => {
    const lane = gateLane(
      [cls('1', { gate_status: 'done' }), cls('2', { gate_status: 'in_progress' }), cls('3'), cls('4'), cls('5')],
      'r1',
      DAY,
    )!;
    expect(ids(lane.inRing)).toEqual(['2']);
    expect(lane.underway).toBe(true);
    expect(lane.onDeck?.id).toBe('3');
    expect(lane.inTheHole?.id).toBe('4');
    expect(ids(lane.comingUp)).toEqual(['5']);
  });

  it('shows classes run together as all in the ring', () => {
    const lane = gateLane(
      [cls('1', { gate_status: 'in_progress' }), cls('2', { gate_status: 'in_progress' }), cls('3')],
      'r1',
      DAY,
    )!;
    expect(ids(lane.inRing)).toEqual(['1', '2']);
    expect(lane.onDeck?.id).toBe('3');
    expect(lane.inTheHole).toBeNull();
  });

  it('follows the gate, not posted results', () => {
    // Class 1 posted, nothing started at the gate: the gate still has it on deck.
    const lane = gateLane([cls('1', { results_published_at: POSTED }), cls('2'), cls('3')], 'r1', DAY)!;
    expect(lane.inRing).toEqual([]);
    expect(lane.underway).toBe(false);
    expect(lane.onDeck?.id).toBe('1');
    expect(lane.inTheHole?.id).toBe('2');
  });

  it('keeps calling riders above a class posted further down the day', () => {
    // Class 7 posted while 2 to 4 have riders and the gate has started
    // nothing. The schedule's rule closed 1 to 6 and the board read "That's
    // the day"; the gate has 2 on deck once 1 is done.
    const lane = gateLane(
      [
        cls('1', { gate_status: 'done', results_published_at: POSTED }),
        cls('2'),
        cls('3'),
        cls('4'),
        cls('5', { entry_count: 0 }),
        cls('6', { entry_count: 0 }),
        cls('7', { results_published_at: POSTED, entry_count: 2 }),
        cls('8', { entry_count: 0 }),
      ],
      'r1',
      DAY,
    )!;
    expect(lane.onDeck?.id).toBe('2');
    expect(lane.inTheHole?.id).toBe('3');
    expect(ids(lane.comingUp)).toEqual(['4', '7']);
  });

  it('reads a stored ready as not started', () => {
    const lane = gateLane([cls('1', { gate_status: 'ready' }), cls('2')], 'r1', DAY)!;
    expect(lane.underway).toBe(false);
    expect(lane.onDeck?.id).toBe('1');
  });

  it('counts a skipped class as over', () => {
    // Skipping marks a class done at the gate.
    const lane = gateLane([cls('1', { gate_status: 'done' }), cls('2'), cls('3')], 'r1', DAY)!;
    expect(lane.inRing).toEqual([]);
    expect(lane.underway).toBe(true);
    expect(lane.onDeck?.id).toBe('2');
  });

  it('passes over a class nobody is entered in', () => {
    const lane = gateLane([cls('1', { entry_count: 0 }), cls('2'), cls('3', { entry_count: 0 }), cls('4')], 'r1', DAY)!;
    expect(lane.onDeck?.id).toBe('2');
    expect(lane.inTheHole?.id).toBe('4');
  });

  it('counts what is left beyond the coming-up strip', () => {
    const lane = gateLane(
      Array.from({ length: 10 }, (_, i) => cls(String(i + 1))),
      'r1',
      DAY,
    )!;
    expect(ids(lane.comingUp)).toEqual(['3', '4', '5', '6']);
    expect(lane.later).toBe(4);
  });

  it('has nothing to call once the day is run', () => {
    const lane = gateLane([cls('1', { gate_status: 'done' }), cls('2', { gate_status: 'done' })], 'r1', DAY)!;
    expect(lane.inRing).toEqual([]);
    expect(lane.underway).toBe(true);
    expect(lane.onDeck).toBeNull();
  });

  it('reads one ring and leaves the others alone', () => {
    const lane = gateLane(
      [
        cls('1', { gate_status: 'in_progress' }),
        cls('2', { ring_id: 'r2', ring_name: 'Arena 2', gate_status: 'in_progress' }),
        cls('3', { ring_id: 'r2', ring_name: 'Arena 2' }),
        cls('4'),
      ],
      'r2',
      DAY,
    )!;
    expect(ids(lane.inRing)).toEqual(['2']);
    expect(lane.onDeck?.id).toBe('3');
  });

  it('leaves draft classes off', () => {
    const lane = gateLane([cls('1', { status: 'DRAFT' }), cls('2')], 'r1', DAY)!;
    expect(lane.onDeck?.id).toBe('2');
  });

  it('is null for a ring with no classes', () => {
    expect(gateLane([cls('1')], 'r9', DAY)).toBeNull();
  });
});

describe('the day', () => {
  it('is today when the ring runs classes today', () => {
    expect(boardDay(['2026-10-09', '2026-10-10', '2026-10-11'], '2026-10-10')).toBe('2026-10-10');
  });

  it('is the next day with classes before the show or on a day off', () => {
    expect(boardDay(['2026-10-10', '2026-10-11'], '2026-10-08')).toBe('2026-10-10');
    expect(boardDay(['2026-10-09', '2026-10-11'], '2026-10-10')).toBe('2026-10-11');
  });

  it('is the last day once the show is over', () => {
    expect(boardDay(['2026-10-10', '2026-10-11'], '2026-10-20')).toBe('2026-10-11');
  });

  it('does not hold on a day with a class nobody marked done', () => {
    // Saturday's last class never closed; on Sunday the board shows Sunday.
    const lane = gateLane(
      [cls('1', { class_date: '2026-10-10', gate_status: 'in_progress' }), cls('2', { class_date: '2026-10-11' })],
      'r1',
      '2026-10-11',
    )!;
    expect(lane.date).toBe('2026-10-11');
    expect(lane.onDeck?.id).toBe('2');
  });
});

describe('the rings', () => {
  it('lists each ring once, in the show’s ring order', () => {
    expect(
      boardRings([
        cls('1', { ring_id: 'r2', ring_name: 'Arena 2', ring_sort_order: 2 }),
        cls('2', { ring_id: 'r1', ring_name: 'Main Arena', ring_sort_order: 1 }),
        cls('3', { ring_id: 'r2', ring_name: 'Arena 2', ring_sort_order: 2 }),
      ]),
    ).toEqual([
      { key: 'r1', name: 'Main Arena' },
      { key: 'r2', name: 'Arena 2' },
    ]);
  });

  it('keeps classes with no ring together as one', () => {
    expect(boardRings([cls('1', { ring_id: null, ring_name: null }), cls('2', { ring_id: null, ring_name: null })])).toEqual([
      { key: NO_RING, name: null },
    ]);
  });
});

describe('the riders', () => {
  it('numbers a class worked one at a time', () => {
    expect(numbersOrderOfGo({ effective_card_type: 'scored' }, [rider('1')])).toBe(true);
    expect(numbersOrderOfGo({ effective_card_type: 'equitation' }, [rider('1')])).toBe(true);
  });

  it('does not number a rail class by its back numbers', () => {
    expect(numbersOrderOfGo({ effective_card_type: 'placing' }, [rider('1'), rider('2')])).toBe(false);
  });

  it('numbers a rail class whose order the steward set', () => {
    expect(numbersOrderOfGo({ effective_card_type: 'placing' }, [rider('1', { gate_order: 1 }), rider('2')])).toBe(true);
  });

  it('tallies who is checked in, a no-show, or neither', () => {
    expect(
      riderTally([
        rider('1', { gate_checked_in: true }),
        rider('2', { gate_no_show: true }),
        rider('3'),
        rider('4', { gate_checked_in: true }),
      ]),
    ).toEqual({ riders: 4, checkedIn: 2, noShow: 1 });
  });
});
