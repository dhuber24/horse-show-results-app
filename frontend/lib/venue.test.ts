// Globals are imported rather than declared ambiently: see api-error.test.ts.
import { describe, expect, it } from '@jest/globals';

import { venueAddressLine, venueMapUrl } from './venue';

describe('venueAddressLine', () => {
  it('puts the zip after the state, the way an envelope does', () => {
    expect(
      venueAddressLine({ address: '1421 3rd Ave SE', city: 'Rochester', state: 'MN', zip: '55904' }),
    ).toBe('1421 3rd Ave SE, Rochester, MN 55904');
  });

  it('reads with parts missing, as a venue typed in by hand often is', () => {
    expect(venueAddressLine({ city: 'Rochester', state: 'MN' })).toBe('Rochester, MN');
    expect(venueAddressLine({ zip: '55904' })).toBe('55904');
    expect(venueAddressLine({ address: '  ', city: null, state: undefined, zip: '' })).toBe('');
  });
});

describe('venueMapUrl', () => {
  it('searches for the name and the address together', () => {
    const url = venueMapUrl('Olmsted County Fairgrounds', '1421 3rd Ave SE, Rochester, MN 55904');
    expect(url).toBe(
      'https://www.google.com/maps/search/?api=1&query=' +
        encodeURIComponent('Olmsted County Fairgrounds, 1421 3rd Ave SE, Rochester, MN 55904'),
    );
  });

  it('still links a venue with no address on file', () => {
    expect(venueMapUrl('Olmsted County Fairgrounds', null)).toBe(
      'https://www.google.com/maps/search/?api=1&query=Olmsted%20County%20Fairgrounds',
    );
  });

  it('escapes what would otherwise end the query', () => {
    expect(venueMapUrl('Barn & Arena #2', null)).toContain('Barn%20%26%20Arena%20%232');
  });

  it('is null with nothing to search for', () => {
    expect(venueMapUrl(null, null)).toBeNull();
    expect(venueMapUrl('  ', '')).toBeNull();
  });
});
