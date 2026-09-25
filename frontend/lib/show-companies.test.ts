import { describe, expect, it } from '@jest/globals';

// The fetch helper pulls in NextAuth, which jest cannot load; nothing here
// fetches, so it is stubbed rather than dragging the session config in. The
// global `jest`, not the one from '@jest/globals': only the global's
// `jest.mock` is hoisted above the imports by the SWC transform.
declare const jest: typeof import('@jest/globals').jest;
jest.mock('./backend-fetch', () => ({ API_URL: '', readJsonBody: async () => null }));

import {
  NO_FEATURES,
  SHOWBILL_IMPORT,
  defaultUpgradeCompany,
  upgradeRequestFor,
  upgradeText,
} from './show-companies';
import type { MyFeatures } from './show-companies';

const PRO = [{ key: SHOWBILL_IMPORT, label: 'Start a show from its show bill', plan: 'GaitDesk Pro' }];
const OWN = { id: 'own', name: 'Jane Smith', personal: true };
const CLUB = { id: 'club', name: 'Minnesota Paint Club', personal: false };

function mine(overrides: Partial<MyFeatures>): MyFeatures {
  return { ...NO_FEATURES, catalog: PRO, ...overrides };
}

describe('upgradeText', () => {
  it('names the company that is not on the plan', () => {
    expect(upgradeText(mine({ companies: [CLUB] }), SHOWBILL_IMPORT)).toEqual({
      headline: 'You must upgrade to GaitDesk Pro to enable this feature.',
      detail: "Minnesota Paint Club isn't on GaitDesk Pro yet.",
    });
  });

  it('does not read an independent their own name back as a company', () => {
    expect(upgradeText(mine({ companies: [OWN] }), SHOWBILL_IMPORT).detail).toBe(
      "Your account isn't on GaitDesk Pro yet.",
    );
  });

  it('tells somebody in no company what to sort out first', () => {
    // No company means no Request upgrade button, so the words have to do it.
    expect(upgradeText(mine({}), SHOWBILL_IMPORT).detail).toBe('Ask GaitDesk to set your show company up.');
  });
});

describe('defaultUpgradeCompany', () => {
  it('asks on behalf of the club ahead of their own account', () => {
    // A club that pays reaches everyone in it; their own account reaches them.
    expect(defaultUpgradeCompany(mine({ companies: [OWN, CLUB] }))).toBe(CLUB);
  });

  it('falls back to their own account when that is all they have', () => {
    expect(defaultUpgradeCompany(mine({ companies: [OWN] }))).toBe(OWN);
  });

  it('has nobody to ask for when they are in no company', () => {
    expect(defaultUpgradeCompany(mine({}))).toBeNull();
  });
});

describe('upgradeRequestFor', () => {
  const request = {
    feature: SHOWBILL_IMPORT,
    company_id: CLUB.id,
    company_name: CLUB.name,
    requested_at: '2026-09-24T15:00:00Z',
    requested_by_name: 'Sam Lee',
    requested_by_me: false,
  };

  it("finds a colleague's request, so the button is not offered twice", () => {
    expect(upgradeRequestFor(mine({ companies: [CLUB], upgrade_requests: [request] }), SHOWBILL_IMPORT)).toBe(
      request,
    );
  });

  it('ignores a request for some other feature', () => {
    expect(upgradeRequestFor(mine({ upgrade_requests: [request] }), 'another_feature')).toBeNull();
  });
});
