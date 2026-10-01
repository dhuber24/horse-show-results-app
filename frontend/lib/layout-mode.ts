/**
 * Which layout a page is drawn in: the desktop one (the staff sidebar, and
 * office pages at full width) or the mobile one (every page as it was built —
 * for touch, and responsive up from a phone).
 *
 * The root layout writes the answer onto `<html data-layout>`, and the
 * `desktop:` variant in `globals.css` reads it.
 *
 * **Nothing about the device is consulted.** The office roles start on desktop
 * wherever they sign in, and the Mobile view / Desktop view button is the only
 * thing that changes it. An automatic choice — screen width and a mouse —
 * shipped first and was taken out: it put laptops with display scaling under
 * its 1280px line on the mobile layout, it was code and a media query kept in
 * two places, and it meant the server could never know whether to build the
 * sidebar, so it built it for every office page view and let CSS hide it.
 */
export type LayoutMode = 'desktop' | 'mobile';

/** `mobile` when an office browser has pressed Mobile view; absent otherwise.
 *  A cookie rather than a column: the choice belongs to the device — a manager
 *  who wants a phone to be a phone still wants the laptop on desktop. */
export const LAYOUT_COOKIE = 'gd-layout';

/** The sidebar folded to a rail of icons (`collapsed`), or absent for open.
 *  Per browser, like the layout itself. */
export const SIDEBAR_COOKIE = 'gd-sidebar';

/**
 * The roles that work a show from the office, and the only ones offered the
 * desktop layout. Everybody else — exhibitors, trainers, scribes, gate
 * stewards — works from a phone or a tablet in the barn or at the ring, and
 * their screens were built for that and nothing else.
 */
const DESKTOP_ROLES = new Set(['ADMIN', 'SHOW_MANAGER', 'SHOW_SECRETARY']);

export function canUseDesktopLayout(role: string | null | undefined): boolean {
  return !!role && DESKTOP_ROLES.has(role);
}

/** The layout for this person on this browser: desktop for the office roles
 *  unless this browser chose mobile, mobile for everybody else whatever the
 *  cookie says. */
export function layoutFor(role: string | null | undefined, cookie: string | null | undefined): LayoutMode {
  if (!canUseDesktopLayout(role)) return 'mobile';
  return cookie === 'mobile' ? 'mobile' : 'desktop';
}
