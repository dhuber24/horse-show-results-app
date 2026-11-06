import { describe, expect, it } from '@jest/globals';
// The fetch helper pulls in NextAuth, which jest cannot load, and nothing here
// fetches. The global `jest`: only its `mock` is hoisted (see show-companies.test.ts).
declare const jest: typeof import('@jest/globals').jest;
jest.mock('./backend-fetch', () => ({ API_URL: '', readJsonBody: async () => null }));

import {
  companyChips,
  companyVerificationLine,
  companyMoneyLine,
  companyPlanLine,
  companySubscriptionHref,
  parseDollars,
  planChoiceIsNoChange,
  planChoiceTitle,
  planOnToday,
  trainerChips,
  trainerSubscriptionHref,
  type CompanyMoney,
  type TrainerSubscription,
} from './subscriptions';
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
    name: 'Paint Club',
    plan: 'free',
    plan_label: 'GaitDesk Free',
    effective_plan: 'free',
    subscriptions: [],
    grants: [],
    active_grant_id: null,
    features: [],
    verified_at: '2026-01-15T12:00:00+00:00',
    verified_how: 'admin',
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

describe('whether a company has shown who it is', () => {
  const unverified = { verified_at: null, verified_how: null };

  it('asks somebody to look only when the company has asked', () => {
    const asking = company({ ...unverified, verification_requested_at: '2026-11-05T12:00:00+00:00' });
    expect(companyChips(asking, MONEY)).toEqual([{ label: 'Asked to be verified', urgent: true }]);
    expect(companyChips(company(unverified), MONEY)).toEqual([{ label: 'Not verified', urgent: false }]);
    expect(companyChips(company(), MONEY)).toEqual([]);
  });

  it.each<[ShowCompany['verified_how'], string]>([
    [
      'existing',
      'Verified automatically on Jan 15, 2026, when GaitDesk began verifying companies, because it already had a show or had paid. Nobody at GaitDesk has checked it.',
    ],
    ['paid', 'Verified by its first payment to GaitDesk, Jan 15, 2026.'],
    ['admin', 'Verified by a GaitDesk admin, Jan 15, 2026.'],
  ])('says how: %s', (how, line) => {
    expect(companyVerificationLine(company({ verified_how: how }))).toBe(line);
  });

  it('says what is waiting, and that a removal lasts', () => {
    expect(companyVerificationLine(company(unverified))).toBe('Not verified.');
    expect(
      companyVerificationLine(company({ ...unverified, verification_requested_at: '2026-11-05T12:00:00+00:00' })),
    ).toBe('Not verified. Asked Nov 5, 2026.');
    expect(
      companyVerificationLine(company({ ...unverified, verification_removed_at: '2026-11-05T12:00:00+00:00' })),
    ).toBe("Not verified. An admin removed it Nov 5, 2026, and a payment won't bring it back.");
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

describe('a request for a plan', () => {
  it('is flagged on the row where it can be answered', () => {
    const features = [{ key: 'live_boards', plan: 'GaitDesk Pro', requested_at: '2026-10-01T00:00:00Z', enabled: false }];
    expect(companyChips(company({ features } as unknown as Partial<ShowCompany>), MONEY)).toEqual([
      { label: 'Asked for GaitDesk Pro', urgent: true },
    ]);
  });

  it('stops once the company has what it asked for', () => {
    const features = [{ key: 'live_boards', plan: 'GaitDesk Pro', requested_at: '2026-10-01T00:00:00Z', enabled: true }];
    expect(companyChips(company({ features } as unknown as Partial<ShowCompany>), MONEY)).toEqual([]);
  });
});

describe('the plan buttons', () => {
  const grant = { id: 'g1', plan: 'pro', kind: 'trial', starts_on: '2026-11-01', ends_on: '2026-12-01', note: null };
  const onTrial = company({ effective_plan: 'pro', grants: [grant], active_grant_id: 'g1' } as Partial<ShowCompany>);
  const onProPlus = company({ plan: 'basic', effective_plan: 'pro_plus', renews_pro_plus: true });
  const following = company({ plan: 'basic', effective_plan: 'pro_plus', renews_pro_plus: false });
  const lapsed = company({ plan: 'pro', effective_plan: 'free', renews_pro_plus: true, pro_plus_lapsed_since: '2026-10-01' });

  it('light the plan it is on today', () => {
    expect(planOnToday(company({ plan: 'basic', effective_plan: 'basic' }))).toBe('basic');
    expect(planOnToday(onProPlus)).toBe('pro_plus');
    expect(planOnToday(following)).toBe('pro_plus');
    expect(planOnToday(onTrial)).toBe('pro');
  });

  it('light Pro+ while its renewal is unpaid, since that is the plan it holds', () => {
    expect(planOnToday(lapsed)).toBe('pro_plus');
  });

  it('do nothing for the plan a company already chose', () => {
    expect(planChoiceIsNoChange(company({ plan: 'basic', effective_plan: 'basic' }), 'basic')).toBe(true);
    expect(planChoiceIsNoChange(following, 'basic')).toBe(true);
    expect(planChoiceIsNoChange(onTrial, 'free')).toBe(true);
  });

  it('still answer the plan it holds while Pro+ renews: pressing it stops the renewal', () => {
    expect(planChoiceIsNoChange(onProPlus, 'basic')).toBe(false);
    expect(planChoiceIsNoChange(lapsed, 'pro')).toBe(false);
  });

  it('always answer Pro+', () => {
    expect(planChoiceIsNoChange(company(), 'pro_plus')).toBe(false);
    expect(planChoiceIsNoChange(onProPlus, 'pro_plus')).toBe(false);
  });

  it('say what a press does', () => {
    expect(planChoiceTitle(company(), 'pro', 'Pro')).toBe('Move Paint Club to GaitDesk Pro');
    expect(planChoiceTitle(company(), 'free', 'Free')).toBe('Paint Club is on GaitDesk Free');
    expect(planChoiceTitle(company(), 'pro_plus', 'Pro+')).toContain('payment received, invoiced later or complimentary');
  });

  it('say a press during a Pro+ year sets what follows it', () => {
    expect(planChoiceTitle(onProPlus, 'pro', 'Pro')).toBe("Follow Paint Club's Pro+ year with GaitDesk Pro instead of renewing Pro+");
    expect(planChoiceTitle(following, 'basic', 'Basic')).toBe('Paint Club moves to GaitDesk Basic when its Pro+ year runs out');
    expect(planChoiceTitle(onProPlus, 'pro_plus', 'Pro+')).toContain('next year');
  });

  it('say a press during a trial sets what follows it', () => {
    expect(planChoiceTitle(onTrial, 'basic', 'Basic')).toBe("Follow Paint Club's comp or trial with GaitDesk Basic");
    expect(planChoiceTitle(onTrial, 'free', 'Free')).toBe('Paint Club is on GaitDesk Free when its comp or trial ends');
  });

  it('say how a frozen company gets out', () => {
    expect(planChoiceTitle(lapsed, 'basic', 'Basic')).toContain('unfreeze');
    expect(planChoiceTitle(lapsed, 'pro_plus', 'Pro+')).toContain('renewal');
  });
});

describe('the links to where a plan is changed', () => {
  it('open that company or trainer', () => {
    expect(companySubscriptionHref('c1')).toBe('/admin/subscriptions?company=c1');
    expect(trainerSubscriptionHref('t1')).toBe('/admin/subscriptions?tab=trainers&trainer=t1');
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
