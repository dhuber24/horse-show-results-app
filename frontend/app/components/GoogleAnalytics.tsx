'use client';

import { Suspense, useEffect } from 'react';
import Script from 'next/script';
import { usePathname, useSearchParams } from 'next/navigation';
import { isTrackedPage } from '@/lib/analytics';

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

type Props = { measurementId: string; userRole: string };

// The standard gtag.js snippet. Page views after the first are GA4's own
// "page changes based on browser history events" enhanced measurement, on by
// default, which sees App Router navigations — so nothing here sends a
// page_view by hand, and doing so would count every navigation twice.
//
// `next/script` dedupes by `id`/`src`, so leaving a token page and coming back
// never loads or configures the tag a second time.
//
// `user_role` is set before `config`, so the first page view carries it.
// Signing in or out changes it without a page load (the root layout re-renders
// on `router.refresh()`, the inline script does not run again), so the effect
// sets it again once the tag is there. The page view of the navigation that
// signed someone in goes out a moment before that, under the old role.
function GoogleAnalyticsTag({ measurementId, userRole }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    window.gtag?.('set', 'user_properties', { user_role: userRole });
  }, [userRole]);

  if (!isTrackedPage(pathname, searchParams)) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('set', 'user_properties', { user_role: ${JSON.stringify(userRole)} });
gtag('config', ${JSON.stringify(measurementId)});`}
      </Script>
    </>
  );
}

// `useSearchParams` needs a Suspense boundary on any page Next prerenders.
// None do today — the root layout reads the session — but the tag should not
// be what breaks the build if one ever does.
export default function GoogleAnalytics(props: Props) {
  return (
    <Suspense fallback={null}>
      <GoogleAnalyticsTag {...props} />
    </Suspense>
  );
}
