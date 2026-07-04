const BASE = '/Kamdhenu-EMS';
const CACHE_NAME = 'kamdhenu-ems-v3';
const ASSETS_TO_CACHE = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/manifest.json',
  BASE + '/fonts/material-symbols-rounded.ttf',
  BASE + '/icons/icon-192.png',
  BASE + '/icons/icon-512.png',
];

// Install Service Worker and Pre-cache Core Shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching offline shell');
      // addAll can fail if any resource 404s, use individual puts
      return Promise.allSettled(
        ASSETS_TO_CACHE.map(url =>
          fetch(url).then(res => {
            if (res.ok) cache.put(url, res);
          }).catch(() => {})
        )
      );
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

  // Skip Firebase Firestore, auth, APIs, and non-GET requests
  if (
    request.method !== 'GET' ||
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis.com')
  ) {
    return;
  }

  // Handle SPA Navigation requests - always serve index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => {
        return caches.match(BASE + '/index.html') ||
               caches.match(BASE + '/') ||
               fetch(BASE + '/index.html');
      })
    );
    return;
  }

  // Cache-First with Network-Update for Static Assets
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // Update cache in background
        fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse));
          }
        }).catch(() => {});
        return cachedResponse;
      }

      // Fallback to network if not cached
      return fetch(request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseToCache);
        });
        return networkResponse;
      }).catch((err) => {
        console.warn('[Service Worker] Fetch failed:', err);
        if (request.headers.get('accept')?.includes('image')) {
          return caches.match(BASE + '/icons/icon-192.png');
        }
      });
    })
  );
});
