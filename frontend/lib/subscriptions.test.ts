import { describe, expect, it } from '@jest/globals';
// The fetch helper pulls in NextAuth, which jest cannot load, and nothing here
// fetches. The global `jest`: only its `mock` is hoisted (see show-companies.test.ts).
declare const jest: typeof import('@jest/globals').jest;
jest.mock('./backend-fetch', () => ({ API_URL: '', readJsonBody: async () => null }));

import { companyChips, companyMoneyLine, companyPlanLine, parseDollars, trainerChips, type CompanyMoney, type TrainerSubscription } from './subscriptions';
import { formatRate, type ShowCompany } from './show-companies';

const MONEY: CompanyMoney = {
  company_id: 'c1',
  show_count: 0,
  upcoming_show_count: 0,
  open_invoice_count: 0,
  overdue_invoice_count: 0,
  processing_invoice_count: 0,
  open_amount_cents: 0,
  unsettled_show_count: 0,
  unsettled_amount_cents: 0,
  unpaid_year_count: 0,
  renewal_due: false,
  grant_ending_soon: false,
};

const company = (extra: Partial<ShowCompany> = {}) =>
  ({
    id: 'c1',
    plan: 'free',
    plan_label: 'GaitDesk Free',
    effective_plan: 'free',
    subscriptions: [],
    grants: [],
    active_grant_id: null,
    ...extra,
  }) as unknown as ShowCompany;

const TRAINER: TrainerSubscription = {
  id: 't1',
  name: 'Sam Reed',
  business_name: null,
  email: null,
  is_public: true,
  is_pro: true,
  pro_until: '2026-12-01',
  pro_plan: null,
  pro_grant: null,
  pro_grant_note: null,
  pro_request_plan: null,
  pro_requested_at: null,
  pays_by_card: false,
  ending_soon: false,
};

describe('a price as it reads', () => {
  it.each([
    [200, '$2'],
    [450, '$4.50'],
    [149900, '$1,499'],
    [149950, '$1,499.50'],
  ])('reads %d cents', (cents, text) => {
    expect(formatRate(cents)).toBe(text);
  });
});

describe('a typed price', () => {
  it.each([
    ['$4', 400],
    ['4.50', 450],
    ['1,499', 149900],
    ['0', 0],
    [' 19.99 ', 1999],
  ])('reads %s', (typed, cents) => {
    expect(parseDollars(typed)).toBe(cents);
  });

  it.each(['', 'free', '-4', '4.999', '$'])('refuses %j', (typed) => {
    expect(parseDollars(typed)).toBeNull();
  });
});

describe('what needs somebody on a company', () => {
  it('asks nothing of a company with nothing wrong', () => {
    expect(companyChips(company(), MONEY)).toEqual([]);
  });

  it('marks what needs doing as urgent', () => {
    const chips = companyChips(company({ pro_plus_lapsed_since: '2026-10-01' }), {
      ...MONEY,
      overdue_invoice_count: 2,
      unsettled_show_count: 1,
      unsettled_amount_cents: 40000,
      unpaid_year_count: 1,
    });
    expect(chips.map((c) => c.label)).toEqual([
      'Pro+ renewal unpaid since Oct 1, 2026',
      '2 invoices overdue',
      '1 finished show to pay for ($400)',
      '1 Pro+ year unpaid',
    ]);
    expect(chips.every((c) => c.urgent)).toBe(true);
  });

  it('marks what is only coming up as not urgent', () => {
    const chips = companyChips(company(), { ...MONEY, renewal_due: true, grant_ending_soon: true });
    expect(chips.map((c) => c.urgent)).toEqual([false, false]);
  });

  it('stops asking about Pro+ once the company is on it', () => {
    const asked = { pro_plus_requested_at: '2026-10-01T00:00:00Z' };
    expect(companyChips(company(asked), MONEY).map((c) => c.label)).toEqual(['Asked for Pro+']);
    expect(companyChips(company({ ...asked, effective_plan: 'pro_plus' }), MONEY)).toEqual([]);
  });

  it('still shows the rest when the figures did not load', () => {
    expect(companyChips(company({ pro_plus_lapsed_since: '2026-10-01' }), undefined)).toHaveLength(1);
    expect(companyMoneyLine(undefined)).toBe('Figures unavailable');
  });
});

describe('the line under a company', () => {
  it('says so when it has run nothing', () => {
    expect(companyMoneyLine(MONEY)).toBe('No shows yet');
  });

  it('counts its shows and what is in flight', () => {
    expect(
      companyMoneyLine({
        ...MONEY,
        show_count: 3,
        upcoming_show_count: 1,
        open_amount_cents: 12000,
        processing_invoice_count: 1,
      }),
    ).toBe('3 shows, 1 running or to come · $120 invoiced and open · 1 bank payment on its way');
  });
});

describe('how long a plan runs', () => {
  const trial = { id: 'g1', plan: 'pro', kind: 'trial', starts_on: '2026-11-01', ends_on: '2026-12-01', note: null };

  it('says when a trial ends and what follows', () => {
    const on = company({ effective_plan: 'pro', grants: [trial], active_grant_id: 'g1' } as Partial<ShowCompany>);
    expect(companyPlanLine(on)).toBe('Through Dec 1, 2026, then GaitDesk Free');
  });

  it('says a comp has no end', () => {
    const comp = { ...trial, kind: 'comp', ends_on: null };
    const on = company({ effective_plan: 'pro', grants: [comp], active_grant_id: 'g1' } as Partial<ShowCompany>);
    expect(companyPlanLine(on)).toBe('No end date');
  });

  it('says nothing of a grant a paid Pro+ year is covering', () => {
    const on = company({
      effective_plan: 'pro_plus',
      renews_pro_plus: true,
      grants: [trial],
      active_grant_id: 'g1',
      subscriptions: [{ ends_on: '2027-06-30' }],
    } as unknown as Partial<ShowCompany>);
    expect(companyPlanLine(on)).toBe('Through Jun 30, 2027, renews');
  });

  it('has nothing to say of a plan that simply runs', () => {
    expect(companyPlanLine(company({ effective_plan: 'basic' }))).toBeNull();
  });
});

describe('what needs somebody on a trainer', () => {
  it('asks nothing of a trainer with nothing wrong', () => {
    expect(trainerChips(TRAINER)).toEqual([]);
  });

  it('flags a request', () => {
    expect(trainerChips({ ...TRAINER, pro_request_plan: 'monthly' })).toEqual([{ label: 'Asked for Pro', urgent: true }]);
  });

  it('needs somebody to bill a paid date about to run out, not a trial', () => {
    expect(trainerChips({ ...TRAINER, ending_soon: true })[0].urgent).toBe(true);
    expect(trainerChips({ ...TRAINER, ending_soon: true, pro_grant: 'trial' })[0].urgent).toBe(false);
  });
});
