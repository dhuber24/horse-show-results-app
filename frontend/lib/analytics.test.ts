import { describe, expect, it } from '@jest/globals';

import { gaMeasurementId, isTrackedPath } from './analytics';

describe('gaMeasurementId', () => {
  it('accepts a GA4 measurement ID', () => {
    expect(gaMeasurementId('G-ABC123XYZ9')).toBe('G-ABC123XYZ9');
  });

  it('tidies a pasted value rather than refusing it', () => {
    expect(gaMeasurementId('  g-abc123xyz9\n')).toBe('G-ABC123XYZ9');
  });

  it('loads nothing when unset', () => {
    expect(gaMeasurementId(undefined)).toBeNull();
    expect(gaMeasurementId(null)).toBeNull();
    expect(gaMeasurementId('')).toBeNull();
  });

  it('refuses anything that is not a GA4 ID', () => {
    // Universal Analytics was retired in 2023; its IDs collect nothing now.
    expect(gaMeasurementId('UA-12345678-1')).toBeNull();
    expect(gaMeasurementId('G-')).toBeNull();
    // The ID is written into an inline script, so nothing that could break out
    // of a string literal gets through.
    expect(gaMeasurementId("G-ABC123');alert(1)//")).toBeNull();
  });
});

describe('isTrackedPath', () => {
  it('tracks ordinary pages', () => {
    expect(isTrackedPath('/')).toBe(true);
    expect(isTrackedPath('/shows/abc/schedule')).toBe(true);
    expect(isTrackedPath('/admin/shows/abc/desk')).toBe(true);
  });

  it('never tracks a page whose URL carries a token', () => {
    expect(isTrackedPath('/invite/3f9c2a')).toBe(false);
    expect(isTrackedPath('/horse-requests/3f9c2a')).toBe(false);
  });

  it('matches the route, not a page that merely starts with the same word', () => {
    expect(isTrackedPath('/invites')).toBe(true);
  });
});
