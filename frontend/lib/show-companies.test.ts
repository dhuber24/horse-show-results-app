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
  foldedOwnCompanies,
  upgradeRequestFor,
  upgradeText,
} from './show-companies';
import type { CompanyFeature, MyFeatures, ShowCompany } from './show-companies';

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

describe('foldedOwnCompanies', () => {
  function member(userId: string) {
    return { user_id: userId, full_name: userId, email: `${userId}@example.com`, role: 'SHOW_SECRETARY', added_at: null };
  }
  const PAID: CompanyFeature = {
    key: SHOWBILL_IMPORT,
    label: 'Start a show from its show bill',
    description: '',
    plan: 'GaitDesk Pro',
    enabled: true,
    enabled_at: '2026-09-01T15:00:00Z',
    enabled_by_name: 'Admin',
  };
  function company(id: string, ownerUserId: string | null, memberIds: string[], overrides: Partial<ShowCompany> = {}): ShowCompany {
    return {
      id,
      name: id,
      notes: null,
      created_at: null,
      owner_user_id: ownerUserId,
      self_cancel_days_before: 0,
      members: memberIds.map(member),
      features: [],
      join_requests: [],
      ...overrides,
    };
  }

  it('folds an own company whose owner now works for an organization', () => {
    // Kept by the backend because somebody paid for it -- and still not a
    // separate independent on the list.
    const own = company('Jane Smith', 'jane', ['jane'], { features: [PAID] });
    const club = company('Minnesota Paint Club', null, ['jane', 'sam']);
    expect(foldedOwnCompanies([own, club])).toEqual(new Map([['Jane Smith', ['Minnesota Paint Club']]]));
  });

  it('names every organization the owner works for', () => {
    const own = company('Jane Smith', 'jane', ['jane']);
    const clubs = [company('Club A', null, ['jane']), company('Club B', null, ['jane'])];
    expect(foldedOwnCompanies([own, ...clubs]).get('Jane Smith')).toEqual(['Club A', 'Club B']);
  });

  it('keeps an independent who works for nobody else', () => {
    expect(foldedOwnCompanies([company('Jane Smith', 'jane', ['jane'])]).size).toBe(0);
  });

  it('keeps somebody who has only asked to join', () => {
    // A join request is not a membership; they are independent until approved.
    const club = company('Minnesota Paint Club', null, ['sam'], {
      join_requests: [{ user_id: 'jane', full_name: 'Jane Smith', email: 'jane@example.com', role: 'SHOW_SECRETARY', requested_at: null }],
    });
    expect(foldedOwnCompanies([company('Jane Smith', 'jane', ['jane']), club]).size).toBe(0);
  });

  it('does not count another independent as an organization', () => {
    const own = company('Jane Smith', 'jane', ['jane']);
    const sams = company('Sam Lee', 'sam', ['sam', 'jane']);
    expect(foldedOwnCompanies([own, sams]).has('Jane Smith')).toBe(false);
  });

  it('keeps an own company somebody else is in', () => {
    const own = company('Jane Smith', 'jane', ['jane', 'sam']);
    const club = company('Minnesota Paint Club', null, ['jane']);
    expect(foldedOwnCompanies([own, club]).size).toBe(0);
  });

  it('keeps an own company with an upgrade request waiting', () => {
    // The admin home counts the request; the list has to show where it is.
    const own = company('Jane Smith', 'jane', ['jane'], {
      features: [{ ...PAID, enabled: false, enabled_at: null, enabled_by_name: null, requested_at: '2026-09-20T15:00:00Z' }],
    });
    const club = company('Minnesota Paint Club', null, ['jane']);
    expect(foldedOwnCompanies([own, club]).size).toBe(0);
  });
});
