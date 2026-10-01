/**
 * Which of a menu's links the current page belongs to: the longest href that is
 * the path itself or a parent of it, matched on whole segments.
 *
 * Longest, because the menus nest — `/classes` is the Class Builder and
 * `/classes/judging` is the Scoring step, and a page under the second belongs
 * to it, not to both. Whole segments, because `/fees` is not a parent of
 * `/feesreport`. Null when no link is a parent, so a page the menu does not list
 * highlights nothing rather than whichever entry happened to be shortest.
 */
export function activeNavHref(pathname: string, hrefs: string[]): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  let best: string | null = null;
  for (const href of hrefs) {
    const matches = path === href || path.startsWith(`${href}/`);
    if (matches && (best === null || href.length > best.length)) best = href;
  }
  return best;
}
