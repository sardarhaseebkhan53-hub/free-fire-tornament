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
const VERSION = 'v1';
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
