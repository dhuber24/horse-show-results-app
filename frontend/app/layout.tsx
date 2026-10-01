import type { Metadata, Viewport } from 'next';
import { Inter, Roboto_Mono } from 'next/font/google';
import { cookies } from 'next/headers';
import './globals.css';
import Navbar from './components/Navbar';
import ServiceWorkerRegistration from './components/ServiceWorkerRegistration';
import GoogleAnalytics from './components/GoogleAnalytics';
import { StepAutosaveProvider } from './admin/shows/[id]/setup/_lib/StepAutosave';
import { auth } from '@/auth';
import { gaMeasurementId } from '@/lib/analytics';
import { LAYOUT_COOKIE, SIDEBAR_COOKIE, layoutFor } from '@/lib/layout-mode';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

const robotoMono = Roboto_Mono({
  variable: '--font-roboto-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: {
    default: 'GaitDesk',
    template: '%s · GaitDesk',
  },
  description: 'Entry and results management for ranch and western pleasure horse shows',
  manifest: '/manifest.json',
  applicationName: 'GaitDesk',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
  openGraph: {
    title: 'GaitDesk',
    description: 'Entry and results management for ranch and western pleasure horse shows',
    siteName: 'GaitDesk',
    images: ['/brand/og-image-1200x630.png'],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GaitDesk',
    description: 'Entry and results management for ranch and western pleasure horse shows',
    images: ['/brand/og-image-1200x630.png'],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'GaitDesk',
  },
};

// Literal, not var(--accent): the theme-color meta tag is read by the browser
// chrome before any stylesheet applies, so a CSS variable resolves to nothing.
// Keep in step with manifest.json's theme_color.
export const viewport: Viewport = {
  themeColor: '#2B5CB8',
};

/**
 * `sidebar` is the staff sidebar (`@sidebar/`): a parallel route, because this
 * layout is not re-rendered between pages and the sidebar has to be current on
 * each. It renders nothing for anybody but ADMIN, SHOW_MANAGER and
 * SHOW_SECRETARY.
 *
 * `data-layout` and `data-sidebar` on `<html>` are what the `desktop:` and
 * `collapsed:` variants read (`globals.css`, `lib/layout-mode.ts`). Written here
 * from cookies, so the first paint is already the right layout. The collapse
 * button sets its attribute in place; the layout toggle reloads, since the
 * sidebar is only built for the desktop layout.
 *
 * The step autosave registry wraps the Navbar, the sidebar and the page, so a
 * sidebar link, or the layout toggle, saves a setup step the way the step's own
 * tabs do.
 */
export default async function RootLayout({
  children,
  sidebar,
}: Readonly<{
  children: React.ReactNode;
  sidebar: React.ReactNode;
}>) {
  // Read per request, not at build: every page renders dynamically (Navbar
  // reads the session), so this is the web service's runtime environment.
  const measurementId = gaMeasurementId(process.env.GA_MEASUREMENT_ID);

  const [session, cookieStore] = await Promise.all([auth(), cookies()]);
  const role = (session?.user as { role?: string } | undefined)?.role;
  const layout = layoutFor(role, cookieStore.get(LAYOUT_COOKIE)?.value);
  const collapsed =
    layout === 'desktop' && cookieStore.get(SIDEBAR_COOKIE)?.value === 'collapsed';

  return (
    <html lang="en" data-layout={layout} data-sidebar={collapsed ? 'collapsed' : undefined}>
      <body className={`${inter.variable} ${robotoMono.variable} antialiased min-h-screen desktop:flex desktop:flex-col`}>
        <StepAutosaveProvider>
          {/* Inside the registry, so the layout toggle saves a setup step before
              it reloads the page. */}
          <Navbar />
          {/* On the desktop layout the body is a column and this row takes what
              the Navbar leaves, so the sidebar runs to the foot of the window on a
              short page rather than stopping where the page does. */}
          <div className="desktop:flex desktop:flex-1">
            {sidebar}
            <div className="min-w-0 desktop:flex-1">{children}</div>
          </div>
        </StepAutosaveProvider>
        <ServiceWorkerRegistration />
        {measurementId && <GoogleAnalytics measurementId={measurementId} />}
      </body>
    </html>
  );
}
