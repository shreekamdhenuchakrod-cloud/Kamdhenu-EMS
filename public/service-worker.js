const CACHE_NAME = 'kamdhenu-ems-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Install Service Worker and Pre-cache Core Shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching offline shell');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate Service Worker and Clean Old Caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Clearing old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Interception with Network-First / Cache-Fallback
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip Firebase Firestore, API, and non-GET requests
  if (request.method !== 'GET' || url.hostname.includes('firestore.googleapis.com') || url.hostname.includes('firebase')) {
    return;
  }

  // Handle SPA Navigation requests - serve index.html if offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => {
        return caches.match('/index.html') || caches.match('/');
      })
    );
    return;
  }

  // Cache-First with Network-Update for Static Assets (Vite hashes are immutable)
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch new version in background to update cache for next time
        fetch(request).then((networkResponse) => {
          if (networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse));
          }
        }).catch(() => {/* Ignore network errors offline */});
        return cachedResponse;
      }

      // Fallback to network if not cached
      return fetch(request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        // Cache newly fetched asset
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseToCache);
        });
        return networkResponse;
      }).catch((err) => {
        console.error('[Service Worker] Fetch failed:', err);
        // Fallback for image requests if network fails
        if (request.headers.get('accept').includes('image')) {
          return caches.match('/icons/icon-192.png');
        }
      });
    })
  );
});
