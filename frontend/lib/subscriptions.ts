/**
 * Manage Subscriptions (`/admin/subscriptions`, migration 179): the shapes the
 * backend answers with, and how a row is worded. Every figure here was worked
 * out by the backend (`gaitdesk_invoices.company_money`, `subscription_prices`);
 * this only decides which ones need somebody's attention and how they read.
 */
import { PRO_PLUS, formatDay, formatRate, type CompanyGrant, type PlanKey, type ShowCompany } from './show-companies';
import type { ProPlan } from './trainer-registry';

/** How a trainer's Pro, or a company's plan, was given. */
export type GrantKind = 'comp' | 'trial';

/** A company may also be upgraded (migration 188): Pro's features while it
 *  still pays for its own plan. A trainer has nothing above Pro to upgrade to. */
export type CompanyGrantKind = GrantKind | 'upgrade';

export const GRANT_LABELS: Record<CompanyGrantKind, string> = {
  comp: 'Complimentary',
  trial: 'Free trial',
  upgrade: 'Free upgrade',
};

/** Where a company's plan is changed, with its row open. The one place an admin changes one. */
export const companySubscriptionHref = (companyId: string) => `/admin/subscriptions?company=${companyId}`;

/** Where a trainer's Pro is changed, with their row open. */
export const trainerSubscriptionHref = (trainerId: string) => `/admin/subscriptions?tab=trainers&trainer=${trainerId}`;

/** `GET /subscriptions/companies`, one per company. */
export interface CompanyMoney {
  company_id: string;
  show_count: number;
  upcoming_show_count: number;
  open_invoice_count: number;
  overdue_invoice_count: number;
  processing_invoice_count: number;
  open_amount_cents: number;
  unsettled_show_count: number;
  unsettled_amount_cents: number;
  unpaid_year_count: number;
  renewal_due: boolean;
  grant_ending_soon: boolean;
}

/** `GET /subscriptions/trainers`. */
export interface TrainerSubscription {
  id: string;
  name: string;
  business_name: string | null;
  email: string | null;
  is_public: boolean;
  is_pro: boolean;
  pro_until: string | null;
  pro_plan: ProPlan | null;
  pro_grant: GrantKind | null;
  pro_grant_note: string | null;
  pro_request_plan: ProPlan | null;
  pro_requested_at: string | null;
  pays_by_card: boolean;
  ending_soon: boolean;
}

/** `GET /subscriptions/trainers/{id}/billing`. */
export interface TrainerBilling {
  pays_by_card: boolean;
  can_manage: boolean;
  status: string | null;
  renews: boolean | null;
  period_end: string | null;
  read_failed: boolean;
  pro_grant: GrantKind | null;
  pro_grant_note: string | null;
  pro_prices: Record<ProPlan, number> | null;
}

export interface PriceRow {
  id: string;
  amount_cents: number;
  effective_on: string;
  created_at: string | null;
  set_by_name: string | null;
  scheduled: boolean;
}

/** `GET /subscriptions/prices`. */
export interface SubscriptionPrice {
  key: string;
  label: string;
  per: string;
  audience: 'companies' | 'trainers';
  minimum_cents: number;
  raise_needs_notice: boolean;
  current_cents: number;
  upcoming_cents: number | null;
  upcoming_on: string | null;
  history: PriceRow[];
}

/** `POST /subscriptions/prices`. */
export interface PriceChange {
  prices: SubscriptionPrice[];
  notice_needed: boolean;
  companies_notified: number;
  mail_configured: boolean;
}

export type Chip = { label: string; urgent: boolean };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A typed price in cents, or null when it isn't one. "$4", "4.50" and "1,499" all are. */
export function parseDollars(value: string): number | null {
  const cleaned = value.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** What a company has been given, today, or undefined. */
export function activeGrant(company: ShowCompany) {
  return company.grants?.find((g) => g.id === company.active_grant_id);
}

/**
 * The grant covering today when it is what puts the company on today's plan,
 * as the backend's `lifting_grant` decides: a paid Pro+ year beats it, and an
 * upgrade (migration 188) lifts only Basic -- on Free it waits for the company
 * to choose Basic, and on Pro there is nothing to lift.
 */
export function liftingGrant(company: ShowCompany): CompanyGrant | undefined {
  const grant = activeGrant(company);
  if (!grant || company.effective_plan !== grant.plan) return undefined;
  if (grant.kind === 'upgrade' && company.plan === grant.plan) return undefined;
  return grant;
}

/** An upgrade lifting the company's plan today, or undefined. */
export function liftingUpgrade(company: ShowCompany): CompanyGrant | undefined {
  const grant = liftingGrant(company);
  return grant?.kind === 'upgrade' ? grant : undefined;
}

/** What needs somebody on a company's row: `urgent` needs doing, the rest is coming up. */
export function companyChips(company: ShowCompany, money: CompanyMoney | undefined): Chip[] {
  const chips: Chip[] = [];
  if (company.pro_plus_lapsed_since) {
    chips.push({ label: `Pro+ renewal unpaid since ${formatDay(company.pro_plus_lapsed_since)}`, urgent: true });
  }
  if (money?.overdue_invoice_count) {
    chips.push({ label: `${plural(money.overdue_invoice_count, 'invoice')} overdue`, urgent: true });
  }
  if (money?.unsettled_show_count) {
    chips.push({
      label: `${plural(money.unsettled_show_count, 'finished show')} to pay for (${formatRate(money.unsettled_amount_cents)})`,
      urgent: true,
    });
  }
  if (money?.unpaid_year_count) {
    chips.push({ label: `${plural(money.unpaid_year_count, 'Pro+ year')} unpaid`, urgent: true });
  }
  if (company.pro_plus_requested_at && company.effective_plan !== 'pro_plus') {
    chips.push({ label: 'Asked for Pro+', urgent: true });
  }
  const asked = company.features.find((f) => f.requested_at && !f.enabled);
  if (asked) chips.push({ label: `Asked for ${asked.plan}`, urgent: true });
  if (!company.verified_at && company.verification_requested_at) {
    chips.push({ label: 'Asked to be verified', urgent: true });
  }
  if (money?.renewal_due) chips.push({ label: 'Pro+ renewal due', urgent: false });
  if (money?.grant_ending_soon) chips.push({ label: 'Comp, trial or upgrade ending this week', urgent: false });
  if (!company.verified_at && !company.verification_requested_at) chips.push({ label: 'Not verified', urgent: false });
  return chips;
}

/** The day of a timestamp the backend sent, as `formatDay` reads a date. */
const dayOf = (timestamp: string) => formatDay(timestamp.slice(0, 10));

/** Whether a company has shown who it is, and how, for its row (migration 180). */
export function companyVerificationLine(company: ShowCompany): string {
  if (company.verified_at) {
    const day = dayOf(company.verified_at);
    if (company.verified_how === 'existing') {
      return `Verified automatically on ${day}, when GaitDesk began verifying companies, because it already had a show or had paid. Nobody at GaitDesk has checked it.`;
    }
    if (company.verified_how === 'paid') return `Verified by its first payment to GaitDesk, ${day}.`;
    return `Verified by a GaitDesk admin, ${day}.`;
  }
  if (company.verification_requested_at) {
    return `Not verified. Asked ${dayOf(company.verification_requested_at)}.`;
  }
  if (company.verification_removed_at) {
    return `Not verified. An admin removed it ${dayOf(company.verification_removed_at)}, and a payment won't bring it back.`;
  }
  return 'Not verified.';
}

/** The line under a company's name: its shows, and money in flight. */
export function companyMoneyLine(money: CompanyMoney | undefined): string {
  if (!money) return 'Figures unavailable';
  const parts = [
    money.show_count === 0
      ? 'No shows yet'
      : `${plural(money.show_count, 'show')}${money.upcoming_show_count ? `, ${money.upcoming_show_count} running or to come` : ''}`,
  ];
  if (money.open_amount_cents > 0) parts.push(`${formatRate(money.open_amount_cents)} invoiced and open`);
  if (money.processing_invoice_count > 0) parts.push(`${plural(money.processing_invoice_count, 'bank payment')} on its way`);
  return parts.join(' · ');
}

/** Its plan's standing, in a few words: until when, and what follows. */
export function companyPlanLine(company: ShowCompany): string | null {
  const grant = liftingGrant(company);
  if (grant?.kind === 'upgrade') {
    const until = grant.ends_on ? `through ${formatDay(grant.ends_on)}` : 'with no end date';
    return `Pro free ${until}, billed as ${company.plan_label}`;
  }
  if (grant) {
    return grant.ends_on
      ? `Through ${formatDay(grant.ends_on)}, then ${company.plan_label}`
      : 'No end date';
  }
  if (company.effective_plan === 'pro_plus') {
    const ends = [...(company.subscriptions ?? [])].sort((a, b) => b.ends_on.localeCompare(a.ends_on))[0]?.ends_on;
    return `Through ${formatDay(ends)}${company.renews_pro_plus ? ', renews' : `, then ${company.plan_label}`}`;
  }
  return null;
}

/**
 * The button lit on a company's plan control: what it is on today. While a Pro+
 * renewal is unpaid that is Pro+, the plan it holds, though it has none of its
 * features until it pays (`PlanPicker` shows that as a warning). During a free
 * upgrade it is the plan the company pays for, since that is what it is billed:
 * the row's line says it has Pro's features as well.
 */
export function planOnToday(company: ShowCompany): PlanKey {
  if (company.pro_plus_lapsed_since) return PRO_PLUS;
  if (liftingUpgrade(company)) return company.plan;
  return company.effective_plan ?? company.plan;
}

/** The plan a company is listed under on Manage Subscriptions: what it is on
 *  today, or during an upgrade the plan it pays for, as its lit button is. */
export function listedPlan(company: ShowCompany): PlanKey | undefined {
  return liftingUpgrade(company) ? company.plan : company.effective_plan;
}

/** Pressing it would change nothing: it is what the company already chose, and
 *  it isn't renewing Pro+ instead. Pro+ always opens its form. */
export function planChoiceIsNoChange(company: ShowCompany, key: PlanKey): boolean {
  return key !== PRO_PLUS && key === company.plan && !company.renews_pro_plus;
}

/** What pressing a plan's button does, for its `title`. During a Pro+ year or a
 *  comp or trial, Free, Basic and Pro say what follows it rather than moving it now. */
export function planChoiceTitle(company: ShowCompany, key: PlanKey, label: string): string {
  const name = company.name;
  const full = `GaitDesk ${label}`;
  const lapsed = Boolean(company.pro_plus_lapsed_since);
  const onProPlus = company.effective_plan === PRO_PLUS;
  if (key === PRO_PLUS) {
    if (lapsed) return 'Start the renewal: it picks up the day after the last year ended, and unfreezes the shows';
    if (onProPlus) return `${name} is on ${full}. Start the next year: it begins the day after this one ends`;
    return `Start a Pro+ year for ${name}: payment received, invoiced later or complimentary`;
  }
  if (lapsed) return `Move ${name} to ${full}: its shows unfreeze at once`;
  if (onProPlus) {
    return planChoiceIsNoChange(company, key)
      ? `${name} moves to ${full} when its Pro+ year runs out`
      : `Follow ${name}'s Pro+ year with ${full}${company.renews_pro_plus ? ' instead of renewing Pro+' : ''}`;
  }
  const given = activeGrant(company);
  if (given && given.kind !== 'upgrade') {
    return planChoiceIsNoChange(company, key)
      ? `${name} is on ${full} when its comp or trial ends`
      : `Follow ${name}'s comp or trial with ${full}`;
  }
  // An upgrade leaves the plan the company pays for to the company: a press
  // moves it now, and the upgrade goes on lifting Basic (migration 188).
  if (planChoiceIsNoChange(company, key)) {
    return liftingUpgrade(company) ? `${name} pays for ${full}, and has Pro's features free` : `${name} is on ${full}`;
  }
  if (given && key === 'basic') return `Move ${name} to ${full}: its free upgrade gives it Pro's features`;
  return `Move ${name} to ${full}`;
}

export function trainerChips(trainer: TrainerSubscription): Chip[] {
  const chips: Chip[] = [];
  if (trainer.pro_request_plan) chips.push({ label: 'Asked for Pro', urgent: true });
  if (trainer.ending_soon) {
    chips.push({ label: `Ends ${formatDay(trainer.pro_until)}`, urgent: !trainer.pro_grant });
  }
  return chips;
}
