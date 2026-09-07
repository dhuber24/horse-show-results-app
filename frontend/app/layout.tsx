import type { Metadata, Viewport } from 'next';
import { Inter, Roboto_Mono } from 'next/font/google';
import './globals.css';
import Navbar from './components/Navbar';
import ServiceWorkerRegistration from './components/ServiceWorkerRegistration';

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${robotoMono.variable} antialiased min-h-screen`}>
        <Navbar />
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
