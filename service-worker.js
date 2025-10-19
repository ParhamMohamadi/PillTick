// Read version from the query string (?v=Ver:0.2) that index.html passes in
const versionFromUrl = new URL(location.href).searchParams.get('v');
const APP_VERSION = versionFromUrl || 'Ver:0.2';

// Use versioned cache so updates replace old content
const CACHE = `pilltick-${APP_VERSION}`;

// Core files to cache. We don't include ?v here because we bump CACHE per version.
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./script.js",
  "./manifest.json",
  "./version.js"
];

self.addEventListener("install", (e) => {
  // Ensure new SW activates immediately
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request).then(resp => resp || fetch(e.request))
  );
});
