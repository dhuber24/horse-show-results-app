// Bump this on any change to what is cached or how. The name is the *only*
// purge mechanism — `activate` deletes every cache that is not this one — so a
// name that never changes is a cache that is never cleared. v1 held the four
// precached shells below from whenever a browser first installed it, forever.
const CACHE_NAME = 'gaitdesk-v2';

// Public shells worth having when the network is gone. Deliberately short, and
// deliberately only routes that exist and need no session: a precache fetch
// carries no cookies, so caching an authenticated route stores the signed-out
// version of it and serves that to somebody who is signed in.
//
// `/shows` used to be here and 404s — see the install handler.
const PRECACHE_URLS = ['/', '/login'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // One request at a time, each with its own catch — never `cache.addAll`.
      // addAll rejects the whole batch if a single URL answers non-2xx, which
      // rejects `waitUntil`, which fails the install. A worker that fails to
      // install never activates, and the previously installed worker stays in
      // charge of every request with no way to replace it: a deploy cannot
      // dislodge it, including a deploy that fixes this file. `/shows` 404s and
      // was in this list, so v1 had been unreplaceable for as long as that route
      // has been gone. One bad URL must never be able to brick the worker again.
      Promise.all(PRECACHE_URLS.map((url) => cache.add(url).catch(() => {})))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only same-origin GETs are ours to answer. Cache Storage cannot hold a
  // non-GET at all, and intercepting one would break a form post for nothing.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept API calls or auth endpoints — always go to network.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
    return;
  }

  // Navigation requests: network-first, cache only as an offline fallback.
  //
  // This was cache-first with no revalidation, which is why a deploy changed
  // nothing for anyone who had opened the site before: the app shell was served
  // from Cache Storage forever, referencing that build's chunks. The server says
  // `no-store, must-revalidate` on these, and Cache Storage does not honour
  // Cache-Control at all — so the worker was overriding an explicit instruction
  // not to cache, and then never re-checking.
  //
  // The response is deliberately *not* written back to the cache: these are
  // authenticated HTML for most of the app, and storing a bill or a roster in
  // Cache Storage leaves it readable on a shared device after sign-out.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request).then((cached) => cached || caches.match('/'))
      )
    );
    return;
  }

  // Static assets: cache-first, which stays safe because Next content-hashes
  // every chunk filename. A new build produces new URLs that miss this cache and
  // are fetched fresh; the stale entries are for URLs nothing asks for any more,
  // and the CACHE_NAME bump is what eventually collects them.
  if (
    request.destination === 'style' ||
    request.destination === 'script' ||
    request.destination === 'image' ||
    request.destination === 'font'
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
  }
});
