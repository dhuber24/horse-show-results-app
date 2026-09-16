'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // Never in development, and take down one a previous visit installed.
    // `public/sw.js` serves `/_next/static/` cache-first because a production
    // build content-hashes those filenames — but `next dev` does not: the fees
    // step is `/_next/static/chunks/app/admin/shows/[id]/setup/fees/page.js`
    // before and after every edit. So a worker registered on localhost served
    // the first copy of each page it ever fetched, reload after reload, while
    // the server was sending the new one. HMR hides it inside a single tab,
    // which is what makes it look like the change never shipped.
    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
        .catch(() => {});
      if ('caches' in window) {
        caches
          .keys()
          .then((keys) =>
            Promise.all(keys.filter((k) => k.startsWith('gaitdesk-')).map((k) => caches.delete(k)))
          )
          .catch(() => {});
      }
      return;
    }

    navigator.serviceWorker
      .register('/sw.js')
      .catch((err) => console.error('Service worker registration failed:', err));
  }, []);

  return null;
}
