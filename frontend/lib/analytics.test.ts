import { describe, expect, it } from '@jest/globals';

import { gaMeasurementId, gaUserRole, isTrackedPage, isTrackedPath } from './analytics';

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

describe('isTrackedPage', () => {
  it('tracks an ordinary page and its query string', () => {
    expect(isTrackedPage('/profile', new URLSearchParams('tab=horses'))).toBe(true);
    expect(isTrackedPage('/login', new URLSearchParams('next=%2Fshows%2Fabc%2Fsignup'))).toBe(true);
    expect(isTrackedPage('/', null)).toBe(true);
  });

  it('never tracks a token route, whatever its query string', () => {
    expect(isTrackedPage('/invite/3f9c2a', new URLSearchParams())).toBe(false);
  });

  // "Sign in" and "Create an account" on /horse-requests/[token].
  it('never tracks a page whose query string names a token route', () => {
    const next = new URLSearchParams({ next: '/horse-requests/3f9c2a' });
    expect(next.toString()).toBe('next=%2Fhorse-requests%2F3f9c2a');
    expect(isTrackedPage('/login', next)).toBe(false);
    expect(isTrackedPage('/register/trainer', next)).toBe(false);
    expect(
      isTrackedPage('/login', new URLSearchParams({ callbackUrl: 'https://gaitdesk.com/invite/3f9c2a' })),
    ).toBe(false);
  });

  it('matches the route in a query string, not a word that starts the same way', () => {
    expect(isTrackedPage('/login', new URLSearchParams({ next: '/invites' }))).toBe(true);
  });
});

describe('gaUserRole', () => {
  it('sends the role of a signed-in account', () => {
    expect(gaUserRole('SHOW_SECRETARY')).toBe('SHOW_SECRETARY');
    expect(gaUserRole('EXHIBITOR')).toBe('EXHIBITOR');
  });

  it('calls a signed-out visitor a visitor', () => {
    expect(gaUserRole(undefined)).toBe('VISITOR');
    expect(gaUserRole(null)).toBe('VISITOR');
    expect(gaUserRole('')).toBe('VISITOR');
  });

  // Written into an inline script, so nothing but a known role gets through.
  it('sends nothing it does not recognise', () => {
    expect(gaUserRole('RING_STEWARD')).toBe('OTHER');
    expect(gaUserRole("ADMIN'});alert(1)//")).toBe('OTHER');
  });
});
