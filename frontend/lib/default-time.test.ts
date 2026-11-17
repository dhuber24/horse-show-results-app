import { describe, expect, it } from '@jest/globals';
import { DEFAULT_TIME, timeForDay } from './default-time';

describe('timeForDay', () => {
  it('fills in noon when a day is picked with no hour', () => {
    expect(DEFAULT_TIME).toBe('12:00');
    expect(timeForDay('2027-09-22', '')).toBe('12:00');
  });

  it('keeps an hour already there', () => {
    expect(timeForDay('2027-09-22', '16:00')).toBe('16:00');
  });

  it('clears the hour with the day', () => {
    expect(timeForDay('', '16:00')).toBe('');
    expect(timeForDay('', '')).toBe('');
  });
});
