// Read version from ?v=... passed during registration
const versionFromUrl = new URL(self.location.href).searchParams.get('v');
const APP_VERSION = versionFromUrl || 'Ver:0.2';
const CACHE = `pilltick-${APP_VERSION}`;

const CORE_ASSETS = [
  // Intentionally not pre-caching index.html to avoid stale shells
  './styles.css',
  './script.js',
  './manifest.json',
  './version.js'
];

// Allow the page to activate a waiting SW immediately
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE_ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Network-first for navigations (HTML). SWR for other requests.
self.addEventListener('fetch', (e) => {
  const req = e.request;

  const isNavigation =
    req.mode === 'navigate' ||
    req.destination === 'document' ||
    req.headers.get('accept')?.includes('text/html');

  if (isNavigation) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        return caches.match('./index.html').then(r => r || Response.error());
      }
    })());
    return;
  }

  // Stale-while-revalidate for other assets
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const fetchPromise = fetch(req).then((networkResp) => {
      cache.put(req, networkResp.clone());
      return networkResp;
    }).catch(() => null);
    return cached || fetchPromise || Response.error();
  })());
});
