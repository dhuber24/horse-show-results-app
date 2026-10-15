'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFullscreen, useWakeLock } from './hooks';
import { fillPromptFor } from './second-screen';
import { PRESETS, SIZE_ORDER, U_VH, parseSize, type SizeKey } from './units';

/**
 * Everything a live board does as a screen rather than as what it shows: the
 * size off `?size=` (no size, and the route is the board's own page), full
 * screen, a monitor extended or duplicated, the controls that fade in on
 * movement, and the keys that work on every board.
 *
 * Shared so the Results Board, Results & High Point and the Gate Board behave
 * as one kind of screen: a TV set up for one is set up for all of them, and
 * the same press of F or 2 does the same thing on each.
 */
export function useBoardScreen({
  noun,
  canStart = true,
  onBoardKey,
}: {
  /** The board as the office knows it — "the results board". */
  noun: string;
  /** False while the board's page still needs an answer before the board can
   *  run (the gate board's ring): the number keys then do not start it. */
  canStart?: boolean;
  /** The keys only a running board of this kind takes — the results boards'
   *  space to pause and arrows to step. Called after the shared ones. */
  onBoardKey?: (e: KeyboardEvent) => void;
}) {
  // The size is the URL's `?size=` and nothing else — no size, and this is the
  // board's own page. See units.ts for why it is never kept in the browser's
  // storage.
  const searchParams = useSearchParams();
  const size = parseSize(searchParams.get('size'));
  // Started for a monitor from the board's page: extended, in a window of its
  // own on the monitor, or duplicated, in this tab on a tablet or laptop the
  // monitor mirrors. See second-screen.ts.
  const popout = searchParams.get('popout') === '1';
  const duplicate = searchParams.get('duplicate') === '1';
  const prompts = useMemo(() => fillPromptFor(noun), [noun]);
  const fillText = popout ? prompts.extend : duplicate ? prompts.duplicate : null;
  const [keepWindowed, setKeepWindowed] = useState(false);

  // Nothing renders until mounted: a board is laid out from the window's
  // height and shows a clock, and neither exists on the server. Rendering
  // them there would be a wrong-scale frame and a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [vh, setVh] = useState(0);
  const fullscreen = useFullscreen();
  const { enter: enterFullscreen, toggle: toggleFullscreen } = fullscreen;

  useWakeLock(size !== null && duplicate);

  // Controls and cursor surface on movement and go away again, so the board
  // spends its life as a board rather than a web page with buttons on it.
  const [chrome, setChrome] = useState(false);
  const chromeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Held open while a menu in the controls has focus: the browser draws that
  // menu itself, so moving the mouse over it reaches no handler here, and the
  // controls would fade out from under a choice being made.
  const chromePinned = useRef(false);
  const wake = useCallback(() => {
    setChrome(true);
    if (chromeTimer.current) clearTimeout(chromeTimer.current);
    chromeTimer.current = setTimeout(() => {
      if (!chromePinned.current) setChrome(false);
    }, 3000);
  }, []);
  const pinChrome = useCallback(
    (on: boolean) => {
      chromePinned.current = on;
      wake();
    },
    [wake],
  );

  // Written with the History API, which Next folds into its router, so
  // `useSearchParams` follows it with no server round trip. Only the keys
  // named change; the rest of the query stays, so a board's other settings
  // survive a trip to its page and back.
  const setQuery = useCallback((changes: Record<string, string | null>, how: 'push' | 'replace') => {
    const q = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(changes)) {
      if (value == null) q.delete(key);
      else q.set(key, value);
    }
    const qs = q.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    if (how === 'push') window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
  }, []);

  // From the board's page, starting the board is a new history entry, so Back
  // returns to the page. Changing size on a running board replaces the entry
  // instead, so Back does not step through every size somebody tried.
  const choose = useCallback((k: SizeKey, how: 'push' | 'replace') => setQuery({ size: k }, how), [setQuery]);

  // Starting from the board's page. Duplicated, full screen is asked for on
  // the press that starts the board, while the press still counts as one: this
  // screen *is* the monitor, and a tab strip and address bar across the top of
  // a lobby TV is the first thing the room would read.
  const start = useCallback(
    (k: SizeKey, dup: boolean) => {
      if (dup) enterFullscreen();
      setKeepWindowed(false);
      setQuery({ size: k, duplicate: dup ? '1' : null }, 'push');
    },
    [enterFullscreen, setQuery],
  );

  // `?duplicate=1` stays in the URL, so the page comes back with Duplicate
  // screen chosen.
  const toSettings = useCallback(() => setQuery({ size: null }, 'push'), [setQuery]);

  useEffect(() => {
    // Lobby TV, not a page the viewer scrolls — the board owns the whole
    // viewport for as long as it's mounted.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    const read = () => setVh(window.innerHeight);
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);

  // Read through a ref, so a board's handler can close over its own state
  // without the listener being taken down and put back on every render.
  const boardKey = useRef(onBoardKey);
  useEffect(() => {
    boardKey.current = onBoardKey;
  }, [onBoardKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Typing a marquee message on the board's page is typing, not commands:
      // a "1" in the message must not open the board. Nor is a browser
      // shortcut — Ctrl+F is find, not full screen.
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      wake();
      if (e.key >= '1' && e.key <= '3') {
        // From the board's page the number keys start the board on this
        // screen, never duplicated or on the second screen.
        const k = SIZE_ORDER[Number(e.key) - 1];
        if (size) choose(k, 'replace');
        else if (canStart) start(k, false);
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      } else if (size) {
        // The rest drive a running board. On the board's page, space and the
        // arrows belong to the page — pressing a focused button, scrolling.
        boardKey.current?.(e);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choose, start, wake, toggleFullscreen, size, canStart]);

  const preset = size ? PRESETS[size] : PRESETS.room;
  const uPx = (preset.scale * U_VH * vh) / 100;
  const ucPx = uPx * preset.chrome;

  // A browser only goes full screen on a press in that window, so a board for
  // a monitor that is not full screen asks for one.
  const fill =
    fillText &&
    fullscreen.canFullscreen &&
    !fullscreen.isFullscreen &&
    !fullscreen.requesting &&
    !keepWindowed
      ? fillText
      : null;

  return {
    mounted,
    size,
    duplicate,
    preset,
    uPx,
    ucPx,
    fullscreen,
    fill,
    keepWindowed: () => setKeepWindowed(true),
    chrome,
    wake,
    pinChrome,
    setQuery,
    choose,
    start,
    toSettings,
  };
}
