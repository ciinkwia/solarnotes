const CACHE_NAME = 'solarnotes-v2';
const STATIC_ASSETS = ['/', '/style.css', '/app.js', '/icon-192.svg', '/icon-512.svg', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Always go to network for API calls and auth
  if (e.request.url.includes('/api/') || e.request.url.includes('/auth/') || e.request.url.includes('googleapis.com') || e.request.url.includes('gstatic.com') || e.request.url.includes('firebaseapp.com')) {
    return e.respondWith(fetch(e.request));
  }
  // Cache-first for static assets
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
