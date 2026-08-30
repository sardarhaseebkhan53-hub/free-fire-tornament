// =============================================================================
// CLUTCHNEX service worker (Phase 13) — hand-rolled, zero dependencies.
//
// Strategies:
//   • navigations  → network-first, cache the good response, fall back to the
//                    cached page and finally the /offline shell.
//   • static assets→ cache-first (Next build assets are content-hashed; icons,
//                    art, fonts, styles, scripts).
//   • /api/**      → NEVER cached or intercepted (auth tokens, wallets, live
//                    tournament state and room credentials must always be live).
//
// The version constant busts the whole cache on every deploy.
// =============================================================================
const VERSION = 'v2';
const CACHE = `clutchnex-${VERSION}`;
const PRECACHE = [
  '/offline',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const STATIC_PATTERN = /(\.(png|jpe?g|webp|svg|gif|ico|woff2?|ttf|css|js)|^\/_next\/static\/|^\/icons\/|^\/art\/)/i;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // cross-origin: pass through
  if (url.pathname.startsWith('/api/')) return;          // money & auth: always live

  // Page navigations — network first, offline fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches
            .match(req)
            .then((hit) => hit || caches.match('/offline'))
            .then((page) => page || new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } })),
        ),
    );
    return;
  }

  // Hashed/static assets — cache first.
  if (STATIC_PATTERN.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});

// =============================================================================
// Web Push (PHASE 19) — the only two things worth doing in a push handler.
//
//   • The payload carries title/body/deep link; it never carries a token, a room
//     password, or a money amount. Anything sensitive belongs behind an authed request
//     the user makes after clicking — a lock-screen notification is readable by whoever
//     is holding the phone.
//   • Notifications are fire-and-forget UI. Nothing here can affect a transaction, and
//     nothing on the server waits for this either.
//
// Push also silently wakes the SW, which is exactly how the offline cache gets warmed.
// =============================================================================
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    // A non-JSON body is still worth showing — degrade to plain text rather than drop it.
    payload = { title: 'ClutchNex', body: event.data ? event.data.text() : '' };
  }
  // Keys mirror backend/src/lib/push.ts `buildPushBody`: title / body / tag / url / data.
  const title = payload.title || 'ClutchNex';
  const options = {
    body: payload.body || '',
    // Same tag ⇒ replace, so a re-sent reminder does not stack five identical banners.
    tag: payload.tag || undefined,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: payload.url || '/matches', matchId: payload.data ? payload.data.matchId : null },
    timestamp: Date.now(),
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/matches', self.location).href;
  event.waitUntil((async () => {
    // Reuse a tab if one exists: five notifications must not open five tabs.
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if (!('focus' in client)) continue;
      if (client.url !== target && 'navigate' in client) {
        try { await client.navigate(target); } catch (e) { /* cross-origin tab we cannot steer */ }
      }
      return client.focus();
    }
    if (clients.openWindow) return clients.openWindow(target);
  })());
});

self.addEventListener('pushsubscriptionchange', (event) => {
  // The push service rotated or expired our subscription. Re-subscribing needs the
  // user's auth token, which a service worker deliberately does not have — so hand the
  // job to an open tab (which does) instead of letting alerts die silently.
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      try { client.postMessage({ type: 'push:resubscribe' }); } catch (e) { /* closed tab */ }
    }
  })());
});
