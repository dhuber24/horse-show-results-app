/**
 * Show companies and the paid features GaitDesk switches on for them
 * (migration 142, `backend/show_companies.py`).
 *
 * A paid feature is sold to the business that runs the shows and reaches
 * every account in it; an ADMIN has every feature. What a page reads here
 * only decides what to *offer* — each gated endpoint checks for itself, so a
 * stale answer costs an offer, never a feature somebody did not pay for.
 */
import { API_URL, readJsonBody } from '@/lib/backend-fetch';

/** Registry keys, as `show_companies.FEATURES` names them. */
export const SHOWBILL_IMPORT = 'showbill_import';
export const FINANCIAL_REPORTS = 'financial_reports';
export const ASSOCIATION_EXPORT = 'association_export';
export const LIVE_BOARDS = 'live_boards';
export const ONLINE_PAYMENTS = 'online_payments';

/** GaitDesk Basic or GaitDesk Pro (migration 168); Free and Pro+ (169). */
export type PlanKey = 'free' | 'basic' | 'pro' | 'pro_plus';

/** The values `show_companies.plan` takes; Pro+ is a paid year on top. */
export type ColumnPlanKey = 'free' | 'basic' | 'pro';

/** One plan as `show_companies.PLANS` has it -- the frontend never spells a
 *  plan's price or contents itself. */
export interface PlanInfo {
  key: PlanKey;
  label: string;
  /** What GaitDesk charges per exhibitor on a show's roster. */
  rate_cents: number;
  features: string[];
  includes: string[];
  /** A prepaid year's price (Pro+); 0 for the per-exhibitor plans. */
  annual_cents?: number;
  /** Free sets up no show (migration 169). */
  sets_up_shows?: boolean;
  /** A company may pick it itself, from My Company. */
  self_serve?: boolean;
}

/** One paid GaitDesk Pro+ year (migration 169). */
export interface Subscription {
  id: string;
  plan: string;
  starts_on: string;
  ends_on: string;
  price_cents: number;
  payment_method: string | null;
  payment_reference: string | null;
  /** The day it was paid for; null while it is owed (migration 171). */
  payment_received_on: string | null;
  created_at: string | null;
  renewal_reminder_sent_at: string | null;
}

export interface CompanyRef {
  id: string;
  name: string;
  /** The caller's own company, named after them (migration 143). */
  personal?: boolean;
}

/** A paid feature and the subscription that includes it. */
export interface FeatureInfo {
  key: string;
  label: string;
  plan: string;
  /** What the feature does, for the pitch on its locked screen. */
  description?: string;
}

/**
 * A company's standing request for a paid feature (migration 144) — from the
 * caller or a colleague, since the feature is sold to the company.
 */
export interface UpgradeRequest {
  feature: string;
  company_id: string;
  company_name: string;
  requested_at: string | null;
  requested_by_name: string | null;
  requested_by_me: boolean;
}

export interface MyFeatures {
  features: string[];
  companies: CompanyRef[];
  /** Every paid feature, whether or not the caller has it — so a locked
   *  button can name the plan without the frontend spelling it too. */
  catalog: FeatureInfo[];
  /** Requests already made for the caller's companies, so a locked door says
   *  "asked" rather than offering the button twice. */
  upgrade_requests: UpgradeRequest[];
  /** Every plan (migration 168). */
  plans: PlanInfo[];
  /** Any of the caller's companies is on a plan that sets up shows
   *  (migration 169). Creating a show enforces it. */
  can_set_up_shows: boolean;
}

/**
 * The plan one show is on and the Pro features its office may use there
 * (`GET /shows/{id}/plan`). A Pro screen at a show reads this, not the
 * caller's own features: the show's company is what is billed for it.
 */
export interface ShowPlan {
  plan: PlanKey;
  plan_label: string;
  features: string[];
  company_id: string | null;
  company_name: string | null;
  /** The caller works for the show's company and may ask for the upgrade. */
  can_request_upgrade: boolean;
}

/** One show's line on a company's GaitDesk usage statement. */
export interface UsageShow {
  show_id: string;
  show_name: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  exhibitor_count: number;
  rate_cents: number;
  amount_cents: number;
  /** The plan the show is invoiced at (migration 169). */
  billing_plan?: PlanKey;
  billing_plan_label?: string;
}

export interface CompanyUsage {
  company_id: string;
  company_name: string;
  plan: PlanKey;
  plan_label: string;
  rate_cents: number;
  shows: UsageShow[];
  exhibitor_count: number;
  amount_cents: number;
  /** Pro+ years, each its own line (migration 169). */
  subscriptions?: {
    id: string;
    starts_on: string;
    ends_on: string;
    price_cents: number;
    payment_received_on?: string | null;
  }[];
}

export interface CompanyMember {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
  added_at: string | null;
}

export interface CompanyFeature {
  key: string;
  label: string;
  description: string;
  plan: string;
  /** The company's plan includes it today -- the only way to a feature since
   *  migration 170. */
  enabled: boolean;
  included_in_plan?: boolean;
  /** Set while the company is waiting on GaitDesk for it (migration 144).
   *  Moving the company onto a plan that includes it answers the request. */
  requested_at?: string | null;
  requested_by_user_id?: string | null;
  requested_by_name?: string | null;
  requested_by_email?: string | null;
}

/** Somebody waiting to be added (migration 143): they typed this
 *  organization's name at sign-up, or somebody in the company asked for them
 *  from My Company Staff (migration 149). */
export interface CompanyJoinRequest {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
  requested_at: string | null;
  source?: 'signup' | 'company';
  /** The company member standing behind it, if any. */
  vouched_by_name?: string | null;
  vouched_at?: string | null;
}

export interface ShowCompany {
  id: string;
  name: string;
  notes: string | null;
  created_at: string | null;
  /** Set when the company is one independent person's own (migration 143). */
  owner_user_id: string | null;
  /** Days before a show's first day that exhibitors stop cancelling their own
   *  registration; 0 is until the show starts (migration 157). */
  self_cancel_days_before: number;
  /** Migration 168: the per-exhibitor plan (or Free). */
  plan: ColumnPlanKey;
  plan_label: string;
  plan_rate_cents: number;
  /** Migration 169: what it is on today -- Pro+ while a paid year covers it. */
  effective_plan?: PlanKey;
  effective_plan_label?: string;
  subscriptions?: Subscription[];
  pro_plus_requested_at?: string | null;
  pro_plus_requested_by_name?: string | null;
  pro_plus_requested_by_email?: string | null;
  members: CompanyMember[];
  features: CompanyFeature[];
  join_requests: CompanyJoinRequest[];
}

/**
 * Independents' own companies the admin list folds away, each with the
 * organizations its owner now works for.
 *
 * Joining an organization normally deletes somebody's own company
 * (`retire_spare_personal_company`), but not one with a feature switched on --
 * that is a switch somebody paid for -- so it lingers as an "Independent" row
 * for a person who is not independent any more. The list leaves it out and a
 * search that matches it brings it back, which is how an admin finds every
 * company one person is in. Never folded: a company anybody else is in, since
 * it is then theirs too, and one with a request waiting, since the admin home
 * counts that request and the list must show where it is.
 */
export function foldedOwnCompanies(companies: ShowCompany[]): Map<string, string[]> {
  const organizationsOf = new Map<string, string[]>();
  for (const company of companies) {
    if (company.owner_user_id) continue;
    for (const member of company.members) {
      organizationsOf.set(member.user_id, [...(organizationsOf.get(member.user_id) ?? []), company.name]);
    }
  }
  const folded = new Map<string, string[]>();
  for (const company of companies) {
    const owner = company.owner_user_id;
    if (!owner) continue;
    const joined = organizationsOf.get(owner);
    if (!joined) continue;
    if (company.members.some((m) => m.user_id !== owner)) continue;
    if (company.join_requests.length > 0) continue;
    if (company.features.some((f) => f.requested_at && !f.enabled)) continue;
    folded.set(company.id, joined);
  }
  return folded;
}

/** No features, no companies -- what a caller with no clean answer has. */
export const NO_FEATURES: MyFeatures = {
  features: [],
  companies: [],
  catalog: [],
  upgrade_requests: [],
  plans: [],
  can_set_up_shows: false,
};

/**
 * The caller's features, for a server component. Anything short of a clean
 * answer reads as no features: offering a paid screen the endpoint then
 * refuses is worse than not offering it to somebody who has paid, who can
 * reload.
 */
export async function fetchMyFeatures(headers: Record<string, string> | null): Promise<MyFeatures> {
  if (!headers) return NO_FEATURES;
  try {
    const res = await fetch(`${API_URL}/users/me/features`, { headers, cache: 'no-store' });
    if (!res.ok) return NO_FEATURES;
    const body = await readJsonBody(res);
    return {
      features: Array.isArray(body?.features) ? body.features : [],
      companies: Array.isArray(body?.companies) ? body.companies : [],
      catalog: Array.isArray(body?.catalog) ? body.catalog : [],
      upgrade_requests: Array.isArray(body?.upgrade_requests) ? body.upgrade_requests : [],
      plans: Array.isArray(body?.plans) ? body.plans : [],
      can_set_up_shows: body?.can_set_up_shows === true,
    };
  } catch {
    return NO_FEATURES;
  }
}

export function hasFeature(mine: MyFeatures, key: string): boolean {
  return mine.features.includes(key);
}

/** The subscription that includes a feature, from the backend's registry. */
export function planFor(mine: MyFeatures, key: string): string {
  return mine.catalog.find((f) => f.key === key)?.plan ?? 'a GaitDesk subscription';
}

/**
 * What a locked paid feature says, in the words every locked door prints.
 *
 * One sentence to upgrade, then one naming whose plan it is. Somebody in no
 * company at all has no Upgrade link, and needs to know that is the first
 * thing to sort out.
 */
export function upgradeText(mine: MyFeatures, key: string): { headline: string; detail: string } {
  const plan = planFor(mine, key);
  const headline = `You must upgrade to ${plan} to enable this feature.`;
  // An independent's company is named after them, so "Jane Smith isn't on
  // GaitDesk Pro" would read the caller's own name back at them.
  const names = mine.companies.filter((c) => !c.personal).map((c) => c.name);
  if (names.length === 0) {
    return {
      headline,
      detail:
        mine.companies.length > 0
          ? `Your account isn't on ${plan} yet.`
          : 'Ask GaitDesk to set your show company up.',
    };
  }
  const whose =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
  return { headline, detail: `${whose} isn't on ${plan} yet.` };
}

/**
 * A show's plan, for a server component. Anything short of a clean answer is
 * null, and a page reads null as locked -- the same reasoning as
 * `fetchMyFeatures`: the endpoint is the enforcement either way.
 */
export async function fetchShowPlan(
  showId: string,
  headers: Record<string, string> | null,
): Promise<ShowPlan | null> {
  if (!headers) return null;
  try {
    const res = await fetch(`${API_URL}/shows/${showId}/plan`, { headers, cache: 'no-store' });
    if (!res.ok) return null;
    const body = await readJsonBody(res);
    if (!body || !Array.isArray(body.features)) return null;
    return body as ShowPlan;
  } catch {
    return null;
  }
}

export function showHasFeature(plan: ShowPlan | null, key: string): boolean {
  return !!plan && plan.features.includes(key);
}

/**
 * The caller's features narrowed to the show's own company, for the Upgrade
 * link on a show's locked screen: the upgrade is for the company the show is
 * billed to. Null when the caller cannot choose its plan -- a guest secretary
 * from outside the company, or a show with no company of its own.
 */
export function upgradeScopeForShow(mine: MyFeatures, plan: ShowPlan | null): MyFeatures | null {
  if (!plan?.can_request_upgrade || !plan.company_id) return null;
  const companies = mine.companies.filter((c) => c.id === plan.company_id);
  if (companies.length === 0) return null;
  return {
    ...mine,
    companies,
    upgrade_requests: mine.upgrade_requests.filter((r) => r.company_id === plan.company_id),
  };
}

/** A whole-dollar price reads as "$2", anything else to the cent. */
export function formatRate(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** Pro+ is asked for from a locked door like a feature (migration 169). */
export const PRO_PLUS = 'pro_plus';

/** A date-only string ("2026-12-31") as the reader reads it, in no time zone. */
export function formatDay(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
