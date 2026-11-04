/**
 * Manage Subscriptions (`/admin/subscriptions`, migration 179): the shapes the
 * backend answers with, and how a row is worded. Every figure here was worked
 * out by the backend (`gaitdesk_invoices.company_money`, `subscription_prices`);
 * this only decides which ones need somebody's attention and how they read.
 */
import { formatDay, formatRate, type ShowCompany } from './show-companies';
import type { ProPlan } from './trainer-registry';

export type GrantKind = 'comp' | 'trial';

export const GRANT_LABELS: Record<GrantKind, string> = { comp: 'Complimentary', trial: 'Free trial' };

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
  if (money?.renewal_due) chips.push({ label: 'Pro+ renewal due', urgent: false });
  if (money?.grant_ending_soon) chips.push({ label: 'Comp or trial ending this week', urgent: false });
  return chips;
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
  const grant = activeGrant(company);
  if (grant && company.effective_plan === grant.plan) {
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

export function trainerChips(trainer: TrainerSubscription): Chip[] {
  const chips: Chip[] = [];
  if (trainer.pro_request_plan) chips.push({ label: 'Asked for Pro', urgent: true });
  if (trainer.ending_soon) {
    chips.push({ label: `Ends ${formatDay(trainer.pro_until)}`, urgent: !trainer.pro_grant });
  }
  return chips;
}
