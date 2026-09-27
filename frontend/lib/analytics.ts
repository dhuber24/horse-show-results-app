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
const UNTRACKED_PREFIXES = ['/invite/', '/horse-requests/'];

export function isTrackedPath(pathname: string): boolean {
  return !UNTRACKED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
