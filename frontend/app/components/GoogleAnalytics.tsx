'use client';

import { Suspense, useEffect } from 'react';
import Script from 'next/script';
import { usePathname, useSearchParams } from 'next/navigation';
import { NO_ADS_COOKIE, isTrackedPage } from '@/lib/analytics';

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
  interface Navigator {
    globalPrivacyControl?: boolean;
  }
}

type Props = {
  measurementId: string;
  userRole: string;
  /** `gaAdsAllowed`: Google signals and ads personalization may stay on. */
  adsAllowed: boolean;
  /** `gaRemembersNoAds`: mark this browser with `NO_ADS_COOKIE`. */
  rememberNoAds: boolean;
};

const TWO_YEARS = 60 * 60 * 24 * 365 * 2;

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
//
// Google signals and ads personalization follow the same path: set before
// `config` from `adsAllowed` (`gaAdsAllowed` — who the Privacy Policy says
// GaitDesk's advertising may reach) and a Global Privacy Control signal, which
// only the browser can see, and set again when signing in or out changes them.
// The cookie is written even on a page the tag stays off, so a youth exhibitor
// who signs in from an invitation link has marked the browser all the same.
function GoogleAnalyticsTag({ measurementId, userRole, adsAllowed, rememberNoAds }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    window.gtag?.('set', 'user_properties', { user_role: userRole });
  }, [userRole]);

  useEffect(() => {
    if (rememberNoAds) {
      document.cookie = `${NO_ADS_COOKIE}=1; path=/; max-age=${TWO_YEARS}; samesite=lax`;
    }
    const ads = adsAllowed && !navigator.globalPrivacyControl;
    window.gtag?.('set', { allow_google_signals: ads, allow_ad_personalization_signals: ads });
  }, [adsAllowed, rememberNoAds]);

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
var ads = ${JSON.stringify(adsAllowed)} && !navigator.globalPrivacyControl;
gtag('set', { allow_google_signals: ads, allow_ad_personalization_signals: ads });
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
