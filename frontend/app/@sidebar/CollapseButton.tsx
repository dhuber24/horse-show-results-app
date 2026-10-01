'use client';

import { SIDEBAR_COOKIE } from '@/lib/layout-mode';

const YEAR = 60 * 60 * 24 * 365;

/**
 * Folds the sidebar to a rail of icons and back, for the screens that want
 * every pixel — the Class Builder's matrix, the desk's two columns.
 *
 * The state is `<html data-sidebar>`, which the root layout writes from a
 * cookie so a folded sidebar arrives folded rather than opening and snapping
 * shut. Pressing it changes the attribute in place — CSS does the rest — and
 * the cookie carries it to the next page load. Both labels are rendered and the
 * `collapsed:` variant picks one, so the button needs no state of its own to
 * agree with the server.
 */
export default function CollapseButton() {
  function toggle() {
    const root = document.documentElement;
    const collapse = root.dataset.sidebar !== 'collapsed';
    if (collapse) {
      root.dataset.sidebar = 'collapsed';
      document.cookie = `${SIDEBAR_COOKIE}=collapsed; path=/; max-age=${YEAR}; samesite=lax`;
    } else {
      delete root.dataset.sidebar;
      document.cookie = `${SIDEBAR_COOKIE}=; path=/; max-age=0; samesite=lax`;
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-bg-subtle collapsed:justify-center collapsed:px-0"
      style={{ color: 'var(--muted)' }}
    >
      <span aria-hidden className="text-base leading-none collapsed:hidden">«</span>
      <span className="collapsed:hidden">Collapse menu</span>
      <span aria-hidden className="hidden collapsed:inline text-base leading-none">»</span>
      <span className="sr-only hidden collapsed:inline">Expand menu</span>
    </button>
  );
}
