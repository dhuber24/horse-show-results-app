/**
 * Sanitize a `?next=` redirect target.
 *
 * The value arrives in a URL a stranger can compose, so it is only ever used
 * after this: anything that could leave the site is discarded. Accepts a
 * single-slash absolute path (`/shows/abc/signup`) and nothing else —
 * protocol-relative `//evil.com` and absolute `https://evil.com` both read as
 * "somewhere else" to a browser and are exactly what an open redirect is.
 *
 * Returns null when there is nothing safe to use, so callers fall back to their
 * own default rather than to attacker-supplied input.
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('/')) return null;
  // `//host` and `/\host` are both treated as protocol-relative by browsers.
  if (value.startsWith('//') || value.startsWith('/\\')) return null;
  return value;
}
