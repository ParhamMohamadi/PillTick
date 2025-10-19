// Get version from the query (?v=Ver:0.2) that index.html passes during registration
const versionFromUrl = new URL(self.location.href).searchParams.get('v');
const APP_VERSION = versionFromUrl || 'Ver:0.2';
const CACHE = `pilltick-${APP_VERSION}`;

const CORE_ASSETS = [
  // Note: we DO NOT cache index.html here with cache-first; we'll fetch it network-first in 'fetch'
  './styles.css',
  './script.js',
  './manifest.json',
  './version.js'
];

// Allow page to tell us to activate immediately
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('install', (e) => {
  // Take over as soon as possible
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE_ASSETS))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Network-first for navigations (HTML shell). Cache-first for static assets.
self.addEventListener('fetch', (e) => {
  const req = e.request;

  // Treat navigations and index.html specially: NETWORK-FIRST
  const isNavigation = req.mode === 'navigate' ||
                       (req.destination === 'document') ||
                       req.url.endsWith('/') ||
                       req.url.endsWith('/index.html');

  if (isNavigation) {
    e.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req, { cache: 'no-store' });
          // Update a copy in cache for offline fallback
          const cache = await caches.open(CACHE);
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          // Offline fallback
          const cached = await caches.match(req);
          if (cached) return cached;
          // As a last resort, try cached root
          return caches.match('./index.html').then(r => r || Response.error());
        }
      })()
    );
    return;
  }

  // For other requests: STALE-WHILE-REVALIDATE
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      const fetchPromise = fetch(req).then((networkResp) => {
        cache.put(req, networkResp.clone());
        return networkResp;
      }).catch(() => null);
      return cached || fetchPromise || Response.error();
    })()
  );
});
