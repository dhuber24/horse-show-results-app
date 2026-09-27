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
  enabled: boolean;
  enabled_at: string | null;
  enabled_by_name: string | null;
  /** Set while the company is waiting on GaitDesk for this feature (migration
   *  144). Switching it on answers the request. */
  requested_at?: string | null;
  requested_by_user_id?: string | null;
  requested_by_name?: string | null;
  requested_by_email?: string | null;
}

/** Somebody who typed this organization's name at sign-up (migration 143). */
export interface CompanyJoinRequest {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
  requested_at: string | null;
}

export interface ShowCompany {
  id: string;
  name: string;
  notes: string | null;
  created_at: string | null;
  /** Set when the company is one independent person's own (migration 143). */
  owner_user_id: string | null;
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
export const NO_FEATURES: MyFeatures = { features: [], companies: [], catalog: [], upgrade_requests: [] };

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
 * One sentence to upgrade, then one naming whose plan it is — the Request
 * upgrade button beside it asks on behalf of a company, so the office should
 * know which one before pressing it. Somebody in no company at all has no
 * button, and needs to know that is the first thing to sort out.
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
 * The company a locked door asks on behalf of when the caller has not chosen:
 * the organization they work for ahead of their own company, because a club
 * that pays reaches everyone in it.
 */
export function defaultUpgradeCompany(mine: MyFeatures): CompanyRef | null {
  return mine.companies.find((c) => !c.personal) ?? mine.companies[0] ?? null;
}

/** A request for this feature already standing for any of the caller's companies. */
export function upgradeRequestFor(mine: MyFeatures, key: string): UpgradeRequest | null {
  return mine.upgrade_requests.find((r) => r.feature === key) ?? null;
}
