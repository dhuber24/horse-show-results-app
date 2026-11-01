/**
 * Who is offered the scribe screens at a show. The backend refuses anybody
 * else; what this pins is that the office is offered them only at its own
 * shows, and that nobody who may score is left without the door.
 */
import { describe, expect, it } from '@jest/globals';

import { SCORING_ROLES, isShowOfficeRole, mayScore } from './scoring-access';
import type { ShowPlan } from './show-companies';

const PLAN: ShowPlan = {
  plan: 'pro',
  plan_label: 'GaitDesk Pro',
  features: [],
  company_id: 'c1',
  company_name: 'MNSPHC',
  can_request_upgrade: true,
};

describe('mayScore', () => {
  it('offers an admin or a scribe every show, plan or not', () => {
    expect(mayScore('ADMIN', null)).toBe(true);
    expect(mayScore('SCRIBE', null)).toBe(true);
  });

  it('offers the show office the shows whose plan answered them', () => {
    expect(mayScore('SHOW_SECRETARY', PLAN)).toBe(true);
    expect(mayScore('SHOW_MANAGER', PLAN)).toBe(true);
  });

  it('does not offer the office a show it does not work', () => {
    expect(mayScore('SHOW_SECRETARY', null)).toBe(false);
    expect(mayScore('SHOW_MANAGER', null)).toBe(false);
  });

  it('offers nobody else, whatever answered', () => {
    for (const role of ['EXHIBITOR', 'TRAINER', 'GATE_STEWARD', undefined]) {
      expect(mayScore(role, PLAN)).toBe(false);
    }
  });
});

describe('the role list', () => {
  it('lets every role mayScore can say yes to through the scribe route', () => {
    for (const role of ['ADMIN', 'SCRIBE', 'SHOW_MANAGER', 'SHOW_SECRETARY']) {
      expect(SCORING_ROLES).toContain(role);
    }
  });

  it('names the office roles that need the plan looked up first', () => {
    expect(isShowOfficeRole('SHOW_SECRETARY')).toBe(true);
    expect(isShowOfficeRole('SCRIBE')).toBe(false);
  });
});
