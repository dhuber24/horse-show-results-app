'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Keeps a Financials screen's figures current without a manual reload.
 *
 * Recording a payment already refreshes the page it was recorded on, and
 * navigating between the summary and Exhibitors refetches — those paths were
 * never stale. What this covers is the screen that is *already open* when the
 * money changes somewhere else: a show desk routinely has the secretary and the
 * manager both taking payments, and a totals board that silently stopped being
 * true an hour ago is worse than one that says nothing.
 *
 * Two triggers, deliberately both:
 *
 *   * **Focus / visibility.** The common case is a second tab, or coming back to
 *     a screen left open. Refreshing when the tab is looked at again costs one
 *     request at the moment someone is about to read the numbers.
 *   * **An interval, only while visible.** Covers the screen left on-screen at
 *     the desk. Paused on a hidden tab so a forgotten tab is not polling the
 *     show's whole financial rollup all afternoon.
 *
 * `router.refresh()` re-runs the server component and **preserves client
 * state**, so a half-typed payment amount survives a refresh underneath it.
 * `paused` exists anyway, for when a refresh would reorder the list somebody is
 * working in — see the Exhibitors page.
 */
export default function AutoRefresh({
  intervalMs = 30000,
  paused = false,
}: {
  intervalMs?: number;
  paused?: boolean;
}) {
  const router = useRouter();
  // Held in a ref so changing `paused` doesn't tear down and re-arm the timer,
  // which would reset the countdown every time a row is expanded.
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const refresh = () => {
      if (pausedRef.current) return;
      if (document.visibilityState !== 'visible') return;
      router.refresh();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    const timer = intervalMs > 0 ? window.setInterval(refresh, intervalMs) : undefined;

    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [router, intervalMs]);

  return null;
}
