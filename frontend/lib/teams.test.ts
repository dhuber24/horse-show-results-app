import { describe, expect, it } from '@jest/globals';

import { horseLabel, isTeamClass, NAME_JOINER, riderLabel, teamShortLabel, teamSizeLabel } from './teams';

const member = (name: string, horse: { id: string; name: string } | null = null, position = 2) => ({
  exhibitor_id: `id-${name}`,
  exhibitor_name: name,
  horse_id: horse?.id ?? null,
  horse_name: horse?.name ?? null,
  position,
});

describe('team classes (migration 192)', () => {
  it('reads a team out as its riders, the way the backend does', () => {
    expect(NAME_JOINER).toBe(' / ');
    expect(riderLabel('Bella Drevlow', [member('Jennifer Peterson')])).toBe('Bella Drevlow / Jennifer Peterson');
  });

  it('reads an ordinary entry as its one rider', () => {
    expect(riderLabel('Ann Reed', [])).toBe('Ann Reed');
    expect(riderLabel('Ann Reed', undefined)).toBe('Ann Reed');
  });

  it('lists a tandem team as the one horse it rides', () => {
    expect(horseLabel('Krymsun Tiger', [member('Jennifer Peterson')])).toBe('Krymsun Tiger');
  });

  it('lists each horse a teammate brought, once', () => {
    const team = [
      member('Jack Whalen', { id: 'h1', name: 'Kasey' }, 2),
      member('Sue Ahlgren', { id: 'h2', name: 'Marvin' }, 3),
      member('Amy Lund', { id: 'h1', name: 'Kasey' }, 4),
    ];
    expect(horseLabel('Midas', team)).toBe('Midas / Kasey / Marvin');
  });

  it('has no horse to name when nobody rode one on file', () => {
    expect(horseLabel(null, [])).toBeNull();
  });

  it('counts a team class from two riders up', () => {
    expect(isTeamClass(null)).toBe(false);
    expect(isTeamClass(1)).toBe(false);
    expect(isTeamClass(2)).toBe(true);
  });

  it('says how many riders a short team still needs', () => {
    expect(teamShortLabel(1)).toBe('1 rider still to name');
    expect(teamShortLabel(3)).toBe('3 riders still to name');
    expect(teamSizeLabel(4)).toBe('Team of 4');
  });
});
