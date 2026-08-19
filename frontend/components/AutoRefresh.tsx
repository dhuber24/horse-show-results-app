'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  /** How often to re-fetch, in ms. */
  intervalMs?: number;
}

/**
 * Periodically re-runs the server component this is mounted in.
 *
 * For screens that go stale on their own because someone *else* changed
 * something — the scribe's class list, where a class the gate steward just
 * closed should roll into the finished group without a manual reload.
 *
 * Two things it deliberately does:
 *
 * - **Stops while the tab is hidden.** A tablet parked on the in-gate table
 *   all day would otherwise poll until its battery died.
 * - **Refreshes immediately on becoming visible again.** Picking the tablet
 *   back up is exactly the moment the screen needs to be current, and waiting
 *   out the remainder of an interval is what makes a page feel stale.
 *
 * `router.refresh()` re-renders on the server and reconciles — it does not
 * remount the tree, so client state (open `<details>`, form values, scroll
 * position) survives. Mount it only where the data actually changes underneath
 * the viewer; polling a finished show is pure waste.
 */
export default function AutoRefresh({ intervalMs = 20000 }: Props) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer === null) timer = setInterval(() => router.refresh(), intervalMs);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        router.refresh();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [router, intervalMs]);

  return null;
}
