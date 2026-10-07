/**
 * The schedule's live badge, read off what happened at the gate and in the
 * office. The cases that matter are the shows that use only one of the two —
 * a show whose steward started class 1 and never touched the gate again left
 * that class "In the ring" all day while its results went up.
 */
import { describe, expect, it } from '@jest/globals';

import { classProgress, type ProgressClass } from './class-progress';

const POSTED = '2026-10-04T15:00:00Z';

function cls(id: string, over: Partial<ProgressClass> = {}): ProgressClass {
  return {
    id,
    class_date: '2026-10-04',
    ring_name: 'Main Arena',
    gate_status: 'pending',
    results_published_at: null,
    ...over,
  };
}

function badges(classes: ProgressClass[]): Record<string, string | undefined> {
  const progress = classProgress(classes);
  return Object.fromEntries(classes.map((c) => [c.id, progress.get(c.id)]));
}

describe('a show that runs the gate', () => {
  it('reads the steward\'s buttons', () => {
    expect(badges([
      cls('1', { gate_status: 'done' }),
      cls('2', { gate_status: 'in_progress' }),
      cls('3', { gate_status: 'ready' }),
      cls('4'),
    ])).toEqual({ 1: 'done', 2: 'in_ring', 3: 'up_next', 4: undefined });
  });

  it('puts the first class up next before anything has run', () => {
    expect(badges([cls('1'), cls('2')])).toEqual({ 1: 'up_next', 2: undefined });
  });
});

describe('a show that only posts results', () => {
  it('counts a posted class as done and the next one as up next', () => {
    expect(badges([
      cls('1', { results_published_at: POSTED }),
      cls('2', { results_published_at: POSTED }),
      cls('3'),
      cls('4'),
    ])).toEqual({ 1: 'done', 2: 'done', 3: 'up_next', 4: undefined });
  });

  it('never claims a class is in the ring without the gate saying so', () => {
    const progress = classProgress([cls('1', { results_published_at: POSTED }), cls('2'), cls('3')]);
    expect([...progress.values()]).not.toContain('in_ring');
  });

  it('counts the classes before a posted one as run, posted or not', () => {
    // The office posts in batches: class 3's results going up means classes
    // 1 and 2 have been through the ring too.
    expect(badges([
      cls('1'),
      cls('2'),
      cls('3', { results_published_at: POSTED }),
      cls('4'),
    ])).toEqual({ 1: 'done', 2: 'done', 3: 'done', 4: 'up_next' });
  });
});

describe('a show that stopped using the gate', () => {
  it('clears a start nobody marked done once its results are posted', () => {
    expect(badges([
      cls('1', { gate_status: 'in_progress', results_published_at: POSTED }),
      cls('2', { results_published_at: POSTED }),
      cls('3'),
    ])).toEqual({ 1: 'done', 2: 'done', 3: 'up_next' });
  });

  it('clears it once a later class is posted, even with its own results still out', () => {
    expect(badges([
      cls('1', { gate_status: 'in_progress' }),
      cls('2', { results_published_at: POSTED }),
      cls('3'),
    ])).toEqual({ 1: 'done', 2: 'done', 3: 'up_next' });
  });

  it('keeps a class in the ring while only earlier classes are posted', () => {
    // Results for class 1 go up while class 2 is still being judged.
    expect(badges([
      cls('1', { results_published_at: POSTED }),
      cls('2', { gate_status: 'in_progress' }),
      cls('3'),
    ])).toEqual({ 1: 'done', 2: 'in_ring', 3: 'up_next' });
  });
});

describe('lanes', () => {
  it('reads each ring on its own', () => {
    expect(badges([
      cls('1', { results_published_at: POSTED }),
      cls('2', { ring_name: 'Pen 2' }),
      cls('3'),
      cls('4', { ring_name: 'Pen 2' }),
    ])).toEqual({ 1: 'done', 2: 'up_next', 3: 'up_next', 4: undefined });
  });

  it('does not let one day\'s results carry into the next', () => {
    expect(badges([
      cls('1', { results_published_at: POSTED }),
      cls('2', { class_date: '2026-10-05' }),
      cls('3', { class_date: '2026-10-05' }),
    ])).toEqual({ 1: 'done', 2: 'up_next', 3: undefined });
  });

  it('leaves a lane with every class run with nothing up next', () => {
    expect(badges([
      cls('1', { gate_status: 'done' }),
      cls('2', { results_published_at: POSTED }),
    ])).toEqual({ 1: 'done', 2: 'done' });
  });
});
