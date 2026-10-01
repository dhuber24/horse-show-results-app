'use client';

import { useState } from 'react';
import { useStepAutosaveFlush } from '../admin/shows/[id]/setup/_lib/StepAutosave';
import { LAYOUT_COOKIE, type LayoutMode } from '@/lib/layout-mode';

const YEAR = 60 * 60 * 24 * 365;

const BUTTON = 'text-sm px-3 py-2 rounded font-medium transition items-center gap-1.5';

/**
 * Switches between the desktop layout (the staff sidebar) and the mobile one.
 * Rendered by the Navbar for ADMIN, SHOW_MANAGER and SHOW_SECRETARY only —
 * nobody else is offered the desktop layout at all (`lib/layout-mode.ts`).
 *
 * The cookie is the whole state: `mobile` once this browser asks for it, and
 * gone again on Desktop view, since desktop is where the office roles start.
 *
 * **A full reload, not `router.refresh()`.** The server builds the sidebar only
 * for the desktop layout, so switching to it has to fetch one — and on Next
 * 15.3 a refresh re-rendered the page but not the root `@sidebar` slot, so
 * Desktop view left the menu missing until the next page. A switch of layout is
 * rare enough that a reload costs nothing worth keeping. The setup step on
 * screen is saved first, as every other way off it is, so a half-filled step
 * is not lost to the reload; a save that fails stays put with its error.
 *
 * Both buttons are rendered and the `desktop:` variant shows the one that
 * leads away from the layout on screen, so the label is right on first paint
 * without the Navbar reading the cookie. On a phone the label folds to its
 * icon — the bar there already holds four buttons — and stays on as the
 * button's name.
 */
export default function LayoutToggle() {
  const flush = useStepAutosaveFlush();
  const [busy, setBusy] = useState(false);

  async function choose(layout: LayoutMode) {
    if (busy) return;
    setBusy(true);
    try {
      await flush();
    } catch {
      setBusy(false);
      return;
    }
    document.cookie =
      layout === 'mobile'
        ? `${LAYOUT_COOKIE}=mobile; path=/; max-age=${YEAR}; samesite=lax`
        : `${LAYOUT_COOKIE}=; path=/; max-age=0; samesite=lax`;
    window.location.reload();
  }

  const style = { backgroundColor: 'var(--slate-raised)', color: 'var(--on-slate)' };

  return (
    <>
      <button
        type="button"
        onClick={() => choose('mobile')}
        disabled={busy}
        className={`${BUTTON} hidden desktop:inline-flex`}
        style={style}
        aria-label="Mobile view"
        title={busy ? 'Switching layout…' : 'Switch to the layout built for phones and tablets, without the menu down the side'}
      >
        <span aria-hidden>📱</span>
        <span aria-hidden className="hidden sm:inline">Mobile view</span>
      </button>
      <button
        type="button"
        onClick={() => choose('desktop')}
        disabled={busy}
        className={`${BUTTON} inline-flex desktop:hidden`}
        style={style}
        aria-label="Desktop view"
        title={busy ? 'Switching layout…' : 'Switch to the desktop layout, with every section in a menu down the side'}
      >
        <span aria-hidden>🖥️</span>
        <span aria-hidden className="hidden sm:inline">Desktop view</span>
      </button>
    </>
  );
}
