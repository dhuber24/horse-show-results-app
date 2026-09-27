'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { isTrackedPath } from '@/lib/analytics';

// The standard gtag.js snippet. Page views after the first are GA4's own
// "page changes based on browser history events" enhanced measurement, on by
// default, which sees App Router navigations — so nothing here sends a
// page_view by hand, and doing so would count every navigation twice.
//
// `next/script` dedupes by `id`/`src`, so leaving a token page and coming back
// never loads or configures the tag a second time.
export default function GoogleAnalytics({ measurementId }: { measurementId: string }) {
  const pathname = usePathname();
  if (!isTrackedPath(pathname)) return null;

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
gtag('config', ${JSON.stringify(measurementId)});`}
      </Script>
    </>
  );
}
