/**
 * The lines a screen prints after saving entries the association rules flagged.
 * Nothing is refused over them, so this is the only place the person who
 * entered hears about them at the time.
 */
import { describe, expect, it } from '@jest/globals';

import { warningLines } from './association-warnings';

const label = (id: string) => `Class ${id}`;

describe('warningLines', () => {
  it('says nothing about an entry with no warnings', () => {
    expect(warningLines([{ class_id: '1' }, { class_id: '2', association_warnings: [] }], label)).toEqual([]);
  });

  it('names the class and puts what the association would not accept first', () => {
    const lines = warningLines(
      [
        { class_id: '4', association_warnings: [{ severity: 'warning', code: 'W', message: 'Earns no points.' }] },
        { class_id: '7', association_warnings: [{ severity: 'error', code: 'E', message: 'Horse is too young.' }] },
      ],
      label,
    );
    expect(lines).toEqual(['Class 7: Horse is too young.', 'Class 4: Earns no points.']);
  });

  it('says the same thing about the same class once', () => {
    const same = { severity: 'error' as const, code: 'E', message: 'Too old for Youth.' };
    expect(
      warningLines([{ class_id: '3', association_warnings: [same, same] }], label),
    ).toEqual(['Class 3: Too old for Youth.']);
  });
});
