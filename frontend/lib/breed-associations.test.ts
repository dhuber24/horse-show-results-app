import { describe, expect, it } from '@jest/globals';

import { associationsForBreeds, nextSuggestedAssociation } from './breed-associations';

/** The registry as seeded — three breed bodies whose names begin with a breed
 *  name, one that does not, and two clubs. */
const ASSOCIATIONS = [
  { id: 'apha', code: 'APHA', name: 'American Paint Horse Association', association_type: 'breed' as const },
  { id: 'aqha', code: 'AQHA', name: 'American Quarter Horse Association', association_type: 'breed' as const },
  { id: 'aphc', code: 'ApHC', name: 'Appaloosa Horse Club', association_type: 'breed' as const },
  { id: 'fqhr', code: 'FQHR', name: 'Foundation Quarter Horse Registry', association_type: 'breed' as const },
  { id: 'wsca', code: 'WSCA', name: 'Western Saddle Club Association', association_type: 'club' as const },
  { id: 'nsba', code: 'NSBA', name: 'National Snaffle Bit Association', association_type: 'club' as const },
];

const breed = (name: string) => ({ id: name, name });

describe('associationsForBreeds', () => {
  it('finds the registry whose name begins with the breed', () => {
    expect(associationsForBreeds([breed('American Paint Horse')], ASSOCIATIONS).map((a) => a.code))
      .toEqual(['APHA']);
    expect(associationsForBreeds([breed('Appaloosa')], ASSOCIATIONS).map((a) => a.code))
      .toEqual(['ApHC']);
  });

  it('handles a horse registered with more than one body', () => {
    expect(
      associationsForBreeds(
        [breed('American Paint Horse'), breed('American Quarter Horse')],
        ASSOCIATIONS,
      ).map((a) => a.code),
    ).toEqual(['APHA', 'AQHA']);
  });

  it('never suggests a club', () => {
    // A club membership is not implied by what the horse is. Nothing about
    // being a Paint says anything about WSCA.
    const codes = associationsForBreeds([breed('American Paint Horse')], ASSOCIATIONS)
      .map((a) => a.code);
    expect(codes).not.toContain('WSCA');
    expect(codes).not.toContain('NSBA');
  });

  it('does not reach a second registry for the same breed', () => {
    // "American Quarter Horse" is a prefix of AQHA's name and not of FQHR's.
    // Which of the two a horse is papered with is a fact about the papers, and
    // guessing it would put a registry on a form nobody chose.
    expect(associationsForBreeds([breed('American Quarter Horse')], ASSOCIATIONS).map((a) => a.code))
      .toEqual(['AQHA']);
  });

  it('suggests nothing for a breed with no registry in the app', () => {
    expect(associationsForBreeds([breed('Morgan')], ASSOCIATIONS)).toEqual([]);
    expect(associationsForBreeds([breed('Crossbred / Grade')], ASSOCIATIONS)).toEqual([]);
  });

  it('suggests nothing when no breed is ticked', () => {
    expect(associationsForBreeds([], ASSOCIATIONS)).toEqual([]);
  });
});

describe('nextSuggestedAssociation', () => {
  it('offers the first implied registry that has no number yet', () => {
    const breeds = [breed('American Paint Horse'), breed('American Quarter Horse')];
    expect(nextSuggestedAssociation(breeds, ASSOCIATIONS, [])?.code).toBe('APHA');
    expect(nextSuggestedAssociation(breeds, ASSOCIATIONS, ['apha'])?.code).toBe('AQHA');
  });

  it('stops once every implied registry is queued', () => {
    // Preselecting anything further would drop an association the exhibitor
    // never asked for into an empty box.
    const breeds = [breed('American Paint Horse')];
    expect(nextSuggestedAssociation(breeds, ASSOCIATIONS, ['apha'])).toBeNull();
  });
});
