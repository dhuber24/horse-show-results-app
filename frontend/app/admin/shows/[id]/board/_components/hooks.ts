'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Observes an element's content box. A callback ref rather than an object
 *  one, because the stage remounts on every slide and the observer has to
 *  follow it. */
export function useBoxSize() {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox((prev) =>
        Math.abs(prev.w - width) < 1 && Math.abs(prev.h - height) < 1 ? prev : { w: width, h: height },
      );
    });
    ro.observe(node);
    observer.current = ro;
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, box] as const;
}

/** Browser full screen for the board.
 *
 *  The page is already a `fixed inset-0` panel, so this is not about layout —
 *  it is about the browser's own chrome. A board dragged onto a lobby TV sits
 *  under a tab strip and an address bar until somebody presses this, and
 *  whoever set it up is usually not the person standing next to the TV with a
 *  keyboard to find F11 on. */
export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  // An iPhone has no full screen for a page at all, and asking somebody to
  // press a button that cannot work is worse than not asking.
  const [canFullscreen, setCanFullscreen] = useState(false);
  // Between asking and the browser answering. A duplicated board asks on the
  // very press that starts it, and without this the *Fill the screen* prompt
  // would flash up for the frame or two before the answer arrives.
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    setCanFullscreen(document.fullscreenEnabled === true);
    const onChange = () => setIsFullscreen(document.fullscreenElement != null);
    onChange();
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const enter = useCallback(() => {
    const root = document.documentElement;
    if (document.fullscreenElement || typeof root.requestFullscreen !== 'function') return;
    // A refused request — an iframe with no `allow`, a gesture the browser did
    // not count — rejects rather than throwing, and the board carries on
    // exactly as it was.
    setRequesting(true);
    void Promise.resolve(root.requestFullscreen())
      .catch(() => {})
      .finally(() => setRequesting(false));
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      enter();
    }
  }, [enter]);

  return { isFullscreen, canFullscreen, requesting, enter, toggle };
}

/** Keeps the display awake while a duplicated board runs.
 *
 *  A tablet on the back of a monitor locks itself after a couple of minutes of
 *  nobody touching it, and the mirrored monitor goes dark with it — the board
 *  is a page nobody touches, by design. The browser drops the lock whenever
 *  the page is hidden, so it is taken again each time the page comes back.
 *  Refused (battery saver, a browser without the API), the board runs exactly
 *  as before. */
export function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let asking = false;
    let stopped = false;

    const acquire = async () => {
      if (stopped || asking || document.visibilityState !== 'visible') return;
      if (sentinel && !sentinel.released) return;
      asking = true;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (stopped) void next.release().catch(() => {});
        else sentinel = next;
      } catch {
        // Refused. Nothing to do but carry on.
      } finally {
        asking = false;
      }
    };

    void acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', acquire);
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => {});
    };
  }, [on]);
}
