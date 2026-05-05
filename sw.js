/* ═══════════════════════════════════════════════════════════
   MOSAIC PUZZLE — Service Worker (Offline + Caching)
   ═══════════════════════════════════════════════════════════ */

const CACHE_NAME = 'mosaic-v3.0'; // bumped: forces cache eviction for coin/star update
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/config.js',
  '/game.js',
  '/ui.js',
  '/db.js',
  '/social.js',
  '/sw.js',
  '/manifest.json',
];

// Install — cache core shell
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => k !== CACHE_NAME)
        .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch — network first for images, cache first for shell
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // For picsum images — network first, fall back to cache, then fallback image
  if (url.hostname === 'picsum.photos') {
    e.respondWith(
      fetch(e.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          return response;
        })
        .catch(() =>
          caches.match(e.request).then(cached => {
            if (cached) return cached;
            // Return a 1x1 colored pixel as ultimate fallback
            return new Response(
              '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#1c1c38"/><text x="200" y="200" text-anchor="middle" fill="#6c63ff" font-size="40" font-family="sans-serif">Offline</text></svg>',
              { headers: { 'Content-Type': 'image/svg+xml' } }
            );
          })
        )
    );
    return;
  }

  // All other requests — cache first, then network
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
