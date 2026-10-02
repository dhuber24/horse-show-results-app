/**
 * Google Analytics (GA4) — what the root layout needs to decide whether to
 * load it, and where.
 *
 * The measurement ID is a runtime setting, `GA_MEASUREMENT_ID` on the web
 * service, read by the root layout on the server — not a `NEXT_PUBLIC_*` build
 * argument, which `Dockerfile.production` deliberately accepts none of. Unset
 * means no tag at all, which is every environment but production.
 */

// GA4 measurement IDs are `G-` and ten or so upper-case alphanumerics. Checked
// rather than trusted because the ID is written into an inline script: a
// mistyped value (a Universal Analytics `UA-…` ID, a stray quote from a paste)
// should load nothing rather than a broken tag.
const MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/;

export function gaMeasurementId(value: string | null | undefined): string | null {
  const id = value?.trim().toUpperCase();
  return id && MEASUREMENT_ID.test(id) ? id : null;
}

// Routes whose URL carries a token, which GA would otherwise record in full as
// `page_location` and keep in Google's reports for anyone with access to the
// property. `/invite/[token]` accepts a staff invitation and creates the
// account; `/horse-requests/[token]` finds a horse transfer request. Both are
// reached from a link in an email or pasted from the screen — a full page load
// — so not loading the tag on them is what keeps the token out. Both leave by
// a client-side navigation to a token-free page, which is where tracking
// starts, and GA reads `document.referrer` (the email client, not the token
// page) for that first hit.
//
// What this does not cover: once the tag has loaded, GA's history listener
// sees every client-side navigation, including the Back button returning to a
// token page earlier in the same tab. Closing that needs page views sent by
// hand with the URL scrubbed, and the enhanced-measurement history option off.
const UNTRACKED_PREFIXES = ['/invite/', '/horse-requests/'];

export function isTrackedPath(pathname: string): boolean {
  return !UNTRACKED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// A query string that names a token route carries the token too, and GA
// records the query string as part of `page_location`. "Sign in" on
// `/horse-requests/[token]` is a client-side navigation to
// `/login?next=%2Fhorse-requests%2F<token>`, and the sign-in and register pages
// hand `next` on to each other, so each of those pages is as untracked as the
// token page itself. Matched anywhere in the value, so an absolute URL counts.
export function isTrackedPage(pathname: string, searchParams?: URLSearchParams | null): boolean {
  if (!isTrackedPath(pathname)) return false;
  for (const value of searchParams?.values() ?? []) {
    if (UNTRACKED_PREFIXES.some((prefix) => value.includes(prefix))) return false;
  }
  return true;
}

// Every role an account can hold (`VALID_ROLES` in `backend/routers/people.py`).
// Sent to GA as the `user_role` user property so spectators, exhibitors and the
// show office can be told apart in reports. Only the role — never a name, email
// or id, which Google's terms forbid sending — and checked against the list
// because it is written into an inline script, like the measurement ID.
const ROLES = new Set([
  'ADMIN',
  'SHOW_MANAGER',
  'SHOW_SECRETARY',
  'SCRIBE',
  'GATE_STEWARD',
  'EXHIBITOR',
  'TRAINER',
  'JUDGE',
]);

export function gaUserRole(role: string | null | undefined): string {
  if (!role) return 'VISITOR';
  return ROLES.has(role) ? role : 'OTHER';
}
